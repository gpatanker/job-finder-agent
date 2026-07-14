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
