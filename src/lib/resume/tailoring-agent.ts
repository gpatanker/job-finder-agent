import Anthropic from "@anthropic-ai/sdk";
import type { ResumeData } from "@/lib/db/schema";
import { deterministicTailoringPlan } from "./deterministic-tailoring";
import { missingKeywords, scoreCoverage } from "./keyword-coverage";
import { applyTailoring } from "./apply-tailoring";
import { emptyTailoringPlan, type TailoringPlan } from "./types";

const MODEL = "claude-sonnet-5";
const COVERAGE_RETRY_THRESHOLD = 55;

const TOOL_NAME = "submit_tailoring_plan";

function buildTool(resume: ResumeData) {
  const bulletOrderProps: Record<string, unknown> = {};
  for (const exp of resume.experience) {
    bulletOrderProps[exp.company] = {
      type: "array",
      items: { type: "string", enum: exp.bullets.map((b) => b.id) },
      description: `Ordering of ${exp.company}'s bullet IDs, most relevant to this job first. Must include every ID exactly once.`,
    };
  }

  return {
    name: TOOL_NAME,
    description:
      "Submit the resume tailoring plan: bullet ordering per company, optional pre-approved phrasing swaps, and skill category ordering.",
    input_schema: {
      type: "object" as const,
      properties: {
        bulletOrder: {
          type: "object",
          properties: bulletOrderProps,
          required: resume.experience.map((e) => e.company),
        },
        phraseChoices: {
          type: "object",
          description:
            'Optional. Map of bulletId -> { originalPhrase: chosenText }. chosenText MUST be exactly one of the pre-approved synonym options given for that bullet/phrase — never invent new wording.',
        },
        skillsOrder: {
          type: "array",
          items: {
            type: "string",
            enum: resume.skills.map((s) => s.category),
          },
          description: "Skill categories in display order, most relevant first. Must include every category exactly once.",
        },
        rationale: {
          type: "string",
          description: "1-2 sentence explanation of the tailoring choices, for display to the candidate.",
        },
      },
      required: ["bulletOrder", "skillsOrder"],
    },
  };
}

function buildInventoryDescription(resume: ResumeData): string {
  const lines: string[] = [];
  for (const exp of resume.experience) {
    lines.push(`\n## ${exp.company} — ${exp.role}`);
    for (const bullet of exp.bullets) {
      const synonymLines = Object.entries(bullet.synonyms)
        .map(([phrase, options]) => `    - "${phrase}" can become: ${options.map((o) => `"${o}"`).join(" / ")}`)
        .join("\n");
      lines.push(
        `- [${bullet.id}] ${bullet.text}\n  keywords: ${bullet.keywords.join(", ")}${synonymLines ? "\n" + synonymLines : ""}`
      );
    }
  }
  lines.push("\n## Skill categories");
  for (const skill of resume.skills) {
    lines.push(`- ${skill.category}: ${skill.items.join(", ")}`);
  }
  return lines.join("\n");
}

function validatePlan(raw: unknown, resume: ResumeData): TailoringPlan {
  const plan = emptyTailoringPlan();
  if (!raw || typeof raw !== "object") return plan;
  const input = raw as Record<string, unknown>;

  const bulletOrderInput = input.bulletOrder as Record<string, unknown> | undefined;
  if (bulletOrderInput) {
    for (const exp of resume.experience) {
      const requested = bulletOrderInput[exp.company];
      if (Array.isArray(requested)) {
        const validIds = new Set(exp.bullets.map((b) => b.id));
        plan.bulletOrder[exp.company] = requested.filter(
          (id): id is string => typeof id === "string" && validIds.has(id)
        );
      }
    }
  }

  const phraseChoicesInput = input.phraseChoices as
    | Record<string, Record<string, string>>
    | undefined;
  if (phraseChoicesInput && typeof phraseChoicesInput === "object") {
    for (const [bulletId, choices] of Object.entries(phraseChoicesInput)) {
      if (choices && typeof choices === "object") {
        plan.phraseChoices[bulletId] = choices;
      }
    }
  }

  const skillsOrderInput = input.skillsOrder;
  if (Array.isArray(skillsOrderInput)) {
    const validCategories = new Set(resume.skills.map((s) => s.category));
    plan.skillsOrder = skillsOrderInput.filter(
      (c): c is string => typeof c === "string" && validCategories.has(c)
    );
  }

  if (typeof input.rationale === "string") {
    plan.rationale = input.rationale;
  }

  return plan;
}

/**
 * Resume Tailoring Agent: given a job description, decides bullet order,
 * pre-approved phrasing swaps, and skill emphasis. Bounded — Claude can only
 * choose among the existing bullet inventory and its pre-approved synonym
 * sets (enforced by validatePlan here and again defensively in
 * applyTailoring), never generate new text. Runs a keyword-coverage
 * self-check and retries once if coverage is weak, then falls back to
 * deterministic keyword-overlap ordering if the API is unavailable or the
 * plan doesn't validate to anything useful.
 */
export async function generateTailoringPlan(
  resume: ResumeData,
  jobDescription: string
): Promise<TailoringPlan> {
  if (!jobDescription.trim()) {
    return emptyTailoringPlan();
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return deterministicTailoringPlan(resume, jobDescription);
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const tool = buildTool(resume);
    const inventory = buildInventoryDescription(resume);

    const systemPrompt =
      "You are a resume-tailoring assistant. You may ONLY reorder the given bullets/skills and swap in phrasing from the pre-approved synonym lists provided. You must NEVER invent new bullet text, new skills, new numbers, or new claims. Every bullet ID for a company must appear exactly once in that company's order. Every skill category must appear exactly once in skillsOrder. Respond only via the submit_tailoring_plan tool.";

    const userMessage = `JOB DESCRIPTION:\n${jobDescription}\n\nRESUME BULLET INVENTORY (fixed — reorder and swap only from this):\n${inventory}\n\nProduce the tailoring plan that best aligns this resume with the job description.`;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userMessage },
    ];

    let response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: systemPrompt,
      messages,
      tools: [tool],
      tool_choice: { type: "tool", name: TOOL_NAME },
    });

    let toolUse = response.content.find((c) => c.type === "tool_use");
    let plan = validatePlan(toolUse?.type === "tool_use" ? toolUse.input : null, resume);
    let tailored = applyTailoring(resume, plan);
    let coverage = scoreCoverage(tailored, jobDescription);

    if (coverage < COVERAGE_RETRY_THRESHOLD && toolUse?.type === "tool_use") {
      const gaps = missingKeywords(tailored, jobDescription);
      // A forced tool_use response MUST be followed by a tool_result block
      // referencing its id — the API rejects the request otherwise (400
      // invalid_request_error). The feedback for the retry goes *in* that
      // tool_result rather than as a separate plain-text message.
      messages.push(
        { role: "assistant", content: response.content },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: `Coverage is weak (${coverage}/100). These job-description keywords aren't reflected yet: ${gaps.slice(0, 15).join(", ")}. If any existing bullet/skill legitimately covers one of these (via its keywords or an approved synonym), revise the plan to surface it. Still choose only from the same fixed inventory — never invent new text. Submit a revised plan.`,
            },
          ],
        }
      );

      response = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: systemPrompt,
        messages,
        tools: [tool],
        tool_choice: { type: "tool", name: TOOL_NAME },
      });

      toolUse = response.content.find((c) => c.type === "tool_use");
      const retryPlan = validatePlan(
        toolUse?.type === "tool_use" ? toolUse.input : null,
        resume
      );
      const retryTailored = applyTailoring(resume, retryPlan);
      const retryCoverage = scoreCoverage(retryTailored, jobDescription);

      if (retryCoverage > coverage) {
        plan = retryPlan;
        coverage = retryCoverage;
      }
    }

    plan.coverageScore = coverage;
    return plan;
  } catch (err) {
    console.error("Resume Tailoring Agent failed, falling back:", err);
    const fallback = deterministicTailoringPlan(resume, jobDescription);
    fallback.coverageScore = scoreCoverage(
      applyTailoring(resume, fallback),
      jobDescription
    );
    return fallback;
  }
}
