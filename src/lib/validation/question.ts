import { z } from "zod";
import { QUESTION_STATUSES } from "@/lib/packet/constants";

export const createQuestionSchema = z.object({
  prompt: z.string().trim().min(1),
  answer: z.string().trim().optional(),
  source: z.string().trim().optional().default("manual"),
});

export const updateQuestionSchema = z.object({
  prompt: z.string().trim().min(1).optional(),
  answer: z.string().trim().optional(),
  status: z.enum(QUESTION_STATUSES).optional(),
});
