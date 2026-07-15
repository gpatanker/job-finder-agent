import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentRunQueue, jobs, resumeProfile } from "@/lib/db/schema";
import { buildApplyRunBrief } from "./brief";
import {
  getApprovedQuestions,
  getCandidateProfileOrThrow,
  getFieldMappingsForPlatform,
} from "./data";
import { detectPlatform } from "@/lib/scraping";
import { checkCandidateUrl } from "@/lib/search/validate-candidate";
import { findDirectSourceUrl } from "@/lib/search/find-direct-source";

const UNVERIFIED_REASON_TEXT: Record<string, string> = {
  closed: "the posting appears to be closed or no longer available",
  generic: "the apply link is a generic careers page, not a specific posting",
  blocked: "the source requires payment to apply",
  unverifiable: "the posting couldn't be verified (the site may be blocking automated checks)",
};

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

  // Postings can go stale between being promoted into the pipeline and
  // actually being queued to apply — confirmed real case: a Figma posting
  // was still live when promoted, generated a tailored resume, and only
  // turned out to be a 404 once someone actually tried to run the queued
  // application. Catching it here (queue time) is as early as this app's
  // architecture allows, since the actual apply run happens externally —
  // there's no server-side "right before it starts" hook to check.
  if (job.applyUrl) {
    let check = await checkCandidateUrl(job.applyUrl, job.title);
    if (!check.ok) {
      const directUrl = await findDirectSourceUrl({ company: job.company, title: job.title });
      if (directUrl) {
        const recheck = await checkCandidateUrl(directUrl, job.title);
        if (recheck.ok) {
          check = recheck;
          job.applyUrl = directUrl;
          await db
            .update(jobs)
            .set({ applyUrl: directUrl, updatedAt: new Date() })
            .where(eq(jobs.id, jobId));
        }
      }
    }
    if (!check.ok) {
      const reasonText = UNVERIFIED_REASON_TEXT[check.reason] ?? "it failed a freshness check";
      return {
        ok: false,
        status: 422,
        error: `Can't queue this application — ${reasonText}. Check the apply link manually before trying again.`,
      };
    }
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
  const knownFieldMappings = job.applyUrl
    ? await getFieldMappingsForPlatform(detectPlatform(job.applyUrl))
    : [];
  const brief = buildApplyRunBrief({
    job,
    profile,
    experience: resume?.data.experience ?? [],
    approvedQuestions,
    knownFieldMappings,
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
