export const JOB_STATUSES = [
  "discovered",
  "needs_review",
  "approval_due",
  "approved",
  "packet_needed",
  "ready_to_apply",
  "queued",
  "in_progress",
  "applied",
  "blocked",
  "rejected",
  "archived",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  discovered: "Discovered",
  needs_review: "Needs Review",
  approval_due: "Approval Due",
  approved: "Approved",
  packet_needed: "Packet Needed",
  ready_to_apply: "Ready to Apply",
  queued: "Queued",
  in_progress: "In Progress",
  applied: "Applied",
  blocked: "Blocked",
  rejected: "Rejected",
  archived: "Archived",
};

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const BLOCK_REASONS = [
  "anti_bot_captcha",
  "posting_removed",
  "eligibility_gate_unresolved",
  "out_of_scope_action",
  "account_creation_required",
  "other",
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export const BLOCK_REASON_LABELS: Record<BlockReason, string> = {
  anti_bot_captcha: "Anti-bot / CAPTCHA challenge",
  posting_removed: "Posting removed or filled",
  eligibility_gate_unresolved: "Eligibility gate unresolved",
  out_of_scope_action: "Out-of-scope action required",
  account_creation_required: "Third-party account creation required",
  other: "Other",
};
