import { z } from "zod";
import { BLOCK_REASONS } from "@/lib/pipeline/constants";

export const AGENT_RUN_STATUSES = [
  "queued",
  "in_progress",
  "completed",
  "blocked",
  "cancelled",
] as const;

export const createAgentRunSchema = z.object({
  jobId: z.string().uuid(),
  submitAuthorized: z.boolean().default(false),
  force: z.boolean().optional(),
});

export const updateAgentRunSchema = z.object({
  status: z.enum(AGENT_RUN_STATUSES).optional(),
  resultSummary: z.string().trim().optional(),
  error: z.string().trim().optional(),
  requiredManualInput: z.boolean().optional(),
  blockReason: z.enum(BLOCK_REASONS).optional(),
});
