import type { Job } from "@/lib/db/schema";

/**
 * Side effects of a job status transition that need to happen no matter
 * which of the two paths reaches "applied" — the "Mark submitted" button
 * (PATCH /api/jobs/[id]) or an agent run completing (PATCH
 * /api/agent-runs/[id], which cascades into the jobs table). Centralized so
 * appliedAt is set exactly once, from either path, rather than duplicated
 * and potentially drifting between the two call sites.
 */
export function computeJobStatusSideEffects(
  existing: Pick<Job, "appliedAt">,
  next: { status?: string }
): Partial<Job> {
  if (next.status === "applied" && !existing.appliedAt) {
    return { appliedAt: new Date() };
  }
  return {};
}
