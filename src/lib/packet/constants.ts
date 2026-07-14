export const QUESTION_STATUSES = [
  "needs_draft",
  "drafted",
  "needs_review",
  "approved",
  "submitted",
] as const;

export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  needs_draft: "Needs Draft",
  drafted: "Drafted",
  needs_review: "Needs Review",
  approved: "Approved",
  submitted: "Submitted",
};
