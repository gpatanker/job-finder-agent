import { z } from "zod";
import {
  APPROVAL_STATUSES,
  JOB_STATUSES,
  WORK_MODES,
} from "@/lib/pipeline/constants";

const optionalUrl = z
  .union([z.literal(""), z.string().url()])
  .optional()
  .transform((v) => (v ? v : undefined));

export const createJobSchema = z.object({
  company: z.string().trim().min(1, "Company is required"),
  title: z.string().trim().min(1, "Title is required"),
  team: z.string().trim().optional(),
  location: z.string().trim().optional(),
  workMode: z.enum(WORK_MODES).optional(),
  sourcePlatform: z.string().trim().optional(),
  applyUrl: optionalUrl,
  jobDescription: z.string().trim().optional(),
  salaryMin: z.coerce.number().int().nonnegative().optional(),
  salaryMax: z.coerce.number().int().nonnegative().optional(),
  salaryText: z.string().trim().optional(),
  matchScore: z.coerce.number().int().min(0).max(100).optional(),
  roleFamily: z.string().trim().optional(),
  resumeAngle: z.string().trim().optional(),
});

export const updateJobSchema = createJobSchema.partial().extend({
  status: z.enum(JOB_STATUSES).optional(),
  approvalStatus: z.enum(APPROVAL_STATUSES).optional(),
  applyAgentStatus: z.string().trim().optional(),
  applyReviewConfirmed: z.boolean().optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type UpdateJobInput = z.infer<typeof updateJobSchema>;
