import type { ApplicationQuestion, Job } from "@/lib/db/schema";

export type PacketReadiness = "no_scan" | "scanned_empty" | "needs_approval" | "ready";

export function computePacketReadiness(
  job: Pick<Job, "applicationPromptsScannedAt">,
  questions: Pick<ApplicationQuestion, "status">[]
): PacketReadiness {
  if (!job.applicationPromptsScannedAt && questions.length === 0) {
    return "no_scan";
  }
  if (questions.length === 0) {
    return "scanned_empty";
  }
  const allApproved = questions.every(
    (q) => q.status === "approved" || q.status === "submitted"
  );
  return allApproved ? "ready" : "needs_approval";
}

export const PACKET_READINESS_COPY: Record<
  PacketReadiness,
  { label: string; tone: "caution" | "ok" | "warn" | "ready" }
> = {
  no_scan: { label: "No prompts scraped yet", tone: "caution" },
  scanned_empty: { label: "Scanned — no candidate-written prompts found", tone: "ok" },
  needs_approval: { label: "Prompts found but not approved", tone: "warn" },
  ready: { label: "Prompts approved", tone: "ready" },
};
