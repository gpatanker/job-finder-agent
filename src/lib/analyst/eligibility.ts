import { desc, gt, and, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs, analystReports } from "@/lib/db/schema";

// Trigger on new signal, not a fixed schedule — see ARCHITECTURE.md. A batch
// of 10 new applications is "enough changed to be worth Opus's attention";
// a single new interview always is, since it's the rarest, highest-value
// outcome signal in the whole pipeline.
const NEW_APPLICATIONS_THRESHOLD = 10;

export type AnalystEligibility =
  | { eligible: true; reason: "new_interview"; detail: string }
  | { eligible: true; reason: "application_batch"; detail: string }
  | { eligible: false; reason: null; detail: string };

/**
 * Whether enough has changed since the last Pipeline Analyst report to
 * justify running Opus again. Read-only — callers decide whether to act on
 * it (POST /api/analyst/run checks this unless `force` is passed).
 */
export async function checkAnalystEligibility(): Promise<AnalystEligibility> {
  const [lastReport] = await db
    .select({ createdAt: analystReports.createdAt })
    .from(analystReports)
    .orderBy(desc(analystReports.createdAt))
    .limit(1);

  const watermark = lastReport?.createdAt ?? new Date(0);

  const newInterviews = await db
    .select({ company: jobs.company, title: jobs.title })
    .from(jobs)
    .where(and(isNotNull(jobs.firstRoundInterviewAt), gt(jobs.firstRoundInterviewAt, watermark)));

  if (newInterviews.length > 0) {
    const names = newInterviews.map((j) => `${j.company} (${j.title})`).join(", ");
    return {
      eligible: true,
      reason: "new_interview",
      detail: `${newInterviews.length} new interview${newInterviews.length === 1 ? "" : "s"} since the last report: ${names}`,
    };
  }

  const newApplications = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(isNotNull(jobs.appliedAt), gt(jobs.appliedAt, watermark)));

  if (newApplications.length >= NEW_APPLICATIONS_THRESHOLD) {
    return {
      eligible: true,
      reason: "application_batch",
      detail: `${newApplications.length} new applications since the last report`,
    };
  }

  return {
    eligible: false,
    reason: null,
    detail: `Only ${newApplications.length} new application${newApplications.length === 1 ? "" : "s"} and 0 new interviews since the last report — needs ${NEW_APPLICATIONS_THRESHOLD}+ applications or 1+ new interview to run again.`,
  };
}
