import type { ApplicationQuestion, Job } from "@/lib/db/schema";

export type ApplyChecklistItem = {
  key: string;
  label: string;
  met: boolean;
};

export function computeApplyChecklist(
  job: Job,
  questions: ApplicationQuestion[]
): ApplyChecklistItem[] {
  const promptsApproved =
    questions.length === 0 || questions.every((q) => q.status === "approved" || q.status === "submitted");

  return [
    { key: "resume", label: "Tailored resume ready", met: Boolean(job.tailoredResumeSlug) },
    { key: "apply_url", label: "Apply link on file", met: Boolean(job.applyUrl) },
    { key: "prompts_scanned", label: "Prompts scanned", met: Boolean(job.applicationPromptsScannedAt) },
    { key: "prompts_approved", label: "Prompts approved (if any)", met: promptsApproved },
    { key: "review_confirmed", label: "Work auth & salary info confirmed", met: job.applyReviewConfirmed },
  ];
}

export function isChecklistComplete(items: ApplyChecklistItem[]): boolean {
  return items.every((item) => item.met);
}
