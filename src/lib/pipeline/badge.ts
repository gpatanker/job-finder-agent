import type { BadgeProps } from "@/components/ui/badge";
import type { JobStatus, ApprovalStatus } from "./constants";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

const JOB_STATUS_VARIANTS: Record<JobStatus, BadgeVariant> = {
  discovered: "neutral",
  needs_review: "neutral",
  approval_due: "warning",
  approved: "info",
  packet_needed: "info",
  ready_to_apply: "info",
  queued: "info",
  in_progress: "info",
  applied: "success",
  blocked: "danger",
  rejected: "danger",
  archived: "neutral",
};

export function jobStatusBadgeVariant(status: string): BadgeVariant {
  return JOB_STATUS_VARIANTS[status as JobStatus] ?? "neutral";
}

const APPROVAL_STATUS_VARIANTS: Record<ApprovalStatus, BadgeVariant> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

export function approvalStatusBadgeVariant(status: string): BadgeVariant {
  return APPROVAL_STATUS_VARIANTS[status as ApprovalStatus] ?? "neutral";
}
