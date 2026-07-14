import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentRunQueue, jobs, resumeProfile } from "@/lib/db/schema";
import { buildApplyRunBrief } from "./brief";
import { getApprovedQuestions, getCandidateProfileOrThrow } from "./data";

export type CreateAgentRunResult =
  | { ok: true; run: typeof agentRunQueue.$inferSelect }
  | { ok: false; status: number; error: string; existingRun?: typeof agentRunQueue.$inferSelect };

export async function createAgentRun(params: {
  jobId: string;
  submitAuthorized: boolean;
  force?: boolean;
}): Promise<CreateAgentRunResult> {
  const { jobId, submitAuthorized, force } = params;

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) {
    return { ok: false, status: 404, error: "Job not found" };
  }

  if (!force) {
    const [activeRun] = await db
      .select()
      .from(agentRunQueue)
      .where(
        and(
          eq(agentRunQueue.jobId, jobId),
          inArray(agentRunQueue.status, ["queued", "in_progress"])
        )
      );
    if (activeRun) {
      return {
        ok: false,
        status: 409,
        error: "An active run already exists for this job.",
        existingRun: activeRun,
      };
    }
  }

  let profile;
  try {
    profile = await getCandidateProfileOrThrow();
  } catch (err) {
    return {
      ok: false,
      status: 400,
      error: err instanceof Error ? err.message : "No candidate profile seeded",
    };
  }

  const approvedQuestions = await getApprovedQuestions(jobId);
  const [resume] = await db.select().from(resumeProfile).limit(1);
  const brief = buildApplyRunBrief({
    job,
    profile,
    experience: resume?.data.experience ?? [],
    approvedQuestions,
    submitAuthorized,
    resumeRoute: job.tailoredResumeSlug ? `/api/resumes/${job.tailoredResumeSlug}` : null,
  });

  const [created] = await db
    .insert(agentRunQueue)
    .values({
      jobId,
      brief,
      submitAuthorized,
      companySnapshot: job.company,
      titleSnapshot: job.title,
    })
    .returning();

  await db
    .update(jobs)
    .set({ applyAgentStatus: "queued", status: "queued", updatedAt: new Date() })
    .where(eq(jobs.id, jobId));

  return { ok: true, run: created };
}
