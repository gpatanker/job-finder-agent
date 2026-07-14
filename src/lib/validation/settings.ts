import { z } from "zod";

const educationEntrySchema = z.object({
  school: z.string().trim().min(1),
  degree: z.string().trim().min(1),
});

const searchCriteriaSchema = z.object({
  roleFamilies: z.array(z.string()),
  locations: z.array(z.string()),
  salaryFloor: z.coerce.number().int().nonnegative().optional(),
  industries: z.array(z.string()),
});

export const updateCandidateProfileSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().trim().optional(),
  linkedin: z.string().trim().optional(),
  location: z.string().trim().optional(),
  currentCompany: z.string().trim().optional(),
  functionTags: z.array(z.string()),
  preferredIndustries: z.array(z.string()),
  workAuthorized: z.boolean(),
  requiresSponsorship: z.boolean(),
  genderIdentity: z.string().trim().optional(),
  raceEthnicity: z.string().trim().optional(),
  sexualOrientation: z.string().trim().optional(),
  veteranStatus: z.string().trim().optional(),
  education: z.array(educationEntrySchema),
  searchCriteria: searchCriteriaSchema,
});

export type UpdateCandidateProfileInput = z.infer<
  typeof updateCandidateProfileSchema
>;

const resumeBulletSchema = z.object({
  id: z.string(),
  text: z.string(),
  keywords: z.array(z.string()),
  synonyms: z.record(z.string(), z.array(z.string())),
});

const resumeExperienceSchema = z.object({
  company: z.string(),
  role: z.string(),
  team: z.string().optional(),
  location: z.string().optional(),
  dateRange: z.string(),
  bullets: z.array(resumeBulletSchema),
});

export const resumeDataSchema = z.object({
  name: z.string(),
  contactLine: z.string(),
  education: z.array(educationEntrySchema),
  experience: z.array(resumeExperienceSchema),
  projects: z.array(
    z.object({
      name: z.string(),
      org: z.string().optional(),
      dateRange: z.string(),
      bullets: z.array(z.string()),
    })
  ),
  skills: z.array(
    z.object({ category: z.string(), items: z.array(z.string()) })
  ),
  certifications: z.array(z.string()),
});

export const createStorySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  title: z.string().trim().min(1),
  tags: z.array(z.string()),
  content: z.string().trim().min(1),
});

export const updateStorySchema = createStorySchema.partial().omit({
  slug: true,
});
