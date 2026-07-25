import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs, llmUsageLog, jobSearchSuggestions, analystReports } from "@/lib/db/schema";
import type { AnalystRecommendation } from "@/lib/db/schema";
import { logAnthropicUsage } from "@/lib/observability/llm-usage";
import type { AnalystEligibility } from "./eligibility";

// Deliberately the top-tier model, not Sonnet — this call is infrequent
// (triggered by new signal, not per-job) and reasons over the whole
// pipeline's aggregate history, which is exactly the kind of high-stakes,
// low-volume judgment call worth paying Opus's higher per-token rate for.
const MODEL = "claude-opus-4-8";
const TOOL_NAME = "submit_analysis";

const submitTool = {
  name: TOOL_NAME,
  description: "Submit the pipeline analysis: a short summary and a list of concrete recommendations.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description: "2-4 sentence executive summary of what the data shows right now.",
      },
      recommendations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short (< 10 words) recommendation title." },
            detail: {
              type: "string",
              description: "1-3 sentences: the specific evidence from the data and the concrete suggested change.",
            },
            category: {
              type: "string",
              enum: ["job_search", "resume_tailoring", "cost", "process", "other"],
            },
          },
          required: ["title", "detail", "category"],
        },
      },
    },
    required: ["summary", "recommendations"],
  },
};

function daysBetween(a: Date | string, b: Date | string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

/**
 * Runs the Pipeline Analyst: gathers the full pipeline's aggregate history
 * (not just what changed since last time — every run sees everything, see
 * ARCHITECTURE.md), asks Opus to find what's correlating with outcomes, and
 * stores the result. Never auto-applies anything — a human (or a Claude Code
 * session, on request) decides what to act on.
 */
export async function runPipelineAnalyst(
  eligibility: AnalystEligibility
): Promise<{ report: typeof analystReports.$inferSelect }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — the Pipeline Analyst requires it.");
  }

  const allJobs = await db
    .select({
      id: jobs.id,
      company: jobs.company,
      title: jobs.title,
      roleFamily: jobs.roleFamily,
      resumeAngle: jobs.resumeAngle,
      resumeCoverageScore: jobs.resumeCoverageScore,
      matchScore: jobs.matchScore,
      status: jobs.status,
      blockReason: jobs.blockReason,
      createdAt: jobs.createdAt,
      appliedAt: jobs.appliedAt,
      firstRoundInterviewAt: jobs.firstRoundInterviewAt,
    })
    .from(jobs)
    .where(eq(jobs.isSample, false));

  const usageRows = await db
    .select({ jobId: llmUsageLog.jobId, estimatedCostUsd: llmUsageLog.estimatedCostUsd })
    .from(llmUsageLog);
  const costByJobId = new Map<string, number>();
  let totalCost = 0;
  for (const r of usageRows) {
    totalCost += r.estimatedCostUsd;
    if (r.jobId) costByJobId.set(r.jobId, (costByJobId.get(r.jobId) ?? 0) + r.estimatedCostUsd);
  }

  const suggestionRows = await db.select({ status: jobSearchSuggestions.status }).from(jobSearchSuggestions);
  const suggestionCounts = suggestionRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const jobLines = allJobs
    .map((j) => {
      const cost = costByJobId.get(j.id);
      const daysToApply = j.appliedAt ? daysBetween(j.createdAt, j.appliedAt).toFixed(1) : "n/a";
      return [
        j.company,
        j.title,
        j.roleFamily ?? "n/a",
        j.resumeAngle ?? "n/a",
        j.resumeCoverageScore != null ? `coverage=${j.resumeCoverageScore}` : "coverage=n/a",
        j.matchScore != null ? `match=${j.matchScore}` : "match=n/a",
        `status=${j.status}`,
        j.blockReason ? `blockReason=${j.blockReason}` : "",
        `cost=$${(cost ?? 0).toFixed(3)}`,
        `daysToApply=${daysToApply}`,
        j.firstRoundInterviewAt ? "INTERVIEW=YES" : "",
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .join("\n");

  const interviewCount = allJobs.filter((j) => j.firstRoundInterviewAt != null).length;
  const appliedCount = allJobs.filter((j) => j.status === "applied").length;

  const systemPrompt = `You are the Pipeline Analyst for a real person's personal job-search automation tool. You review the full history of every job it has tracked and produce a short, concrete analysis: what's actually correlating with getting first-round interviews, what's wasting money, and what specific changes to the resume-tailoring approach, job-search targeting, or process would help. Ground every recommendation in the actual data given — never invent a pattern that isn't visibly supported by the rows below. If the sample size for a pattern is too small to be confident (e.g. only 1-2 interviews total), say so explicitly rather than overclaiming. You MUST call ${TOOL_NAME} with your findings.`;

  const userMessage = `PIPELINE TOTALS
- ${allJobs.length} total tracked jobs, ${appliedCount} applied, ${interviewCount} reached a first-round interview.
- Total estimated LLM/search spend to date: $${totalCost.toFixed(2)}.
- Job Search suggestions by status: ${JSON.stringify(suggestionCounts)}.
- Why this analysis is running now: ${eligibility.eligible ? eligibility.detail : "manually requested"}.

PER-JOB DATA (company | title | role family | resume angle | resume coverage score | search match score | status | block reason if any | estimated $ spent on this job | days from discovered to applied | INTERVIEW=YES if a first-round interview happened)
${jobLines}

Analyze this and call ${TOOL_NAME}.`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [submitTool],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });
  await logAnthropicUsage({ callSite: "pipeline_analyst", model: MODEL, response });

  const toolUse = response.content.find((c) => c.type === "tool_use" && c.name === TOOL_NAME);
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("The Pipeline Analyst didn't return structured results — try again.");
  }

  const input = toolUse.input as { summary?: string; recommendations?: unknown };
  const summary = typeof input.summary === "string" ? input.summary : "No summary returned.";
  const recommendations: AnalystRecommendation[] = Array.isArray(input.recommendations)
    ? input.recommendations
        .filter(
          (r): r is AnalystRecommendation =>
            typeof r === "object" &&
            r !== null &&
            typeof (r as AnalystRecommendation).title === "string" &&
            typeof (r as AnalystRecommendation).detail === "string"
        )
        .map((r) => ({
          title: r.title,
          detail: r.detail,
          category: (r as AnalystRecommendation).category ?? "other",
        }))
    : [];

  const usage = response.usage;
  const estimatedCostUsd =
    usage != null
      ? (usage.input_tokens / 1_000_000) * 5 + (usage.output_tokens / 1_000_000) * 25
      : null;

  const [report] = await db
    .insert(analystReports)
    .values({
      triggerReason: eligibility.eligible ? eligibility.reason : "manual",
      triggerDetail: eligibility.detail,
      jobsAnalyzedCount: allJobs.length,
      model: MODEL,
      summary,
      recommendations,
      estimatedCostUsd,
    })
    .returning();

  return { report };
}
