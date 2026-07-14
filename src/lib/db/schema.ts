import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import type { TailoringPlan } from "@/lib/resume/types";

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  team: text("team"),
  location: text("location"),
  workMode: text("work_mode"),
  sourcePlatform: text("source_platform"),
  applyUrl: text("apply_url"),
  jobDescription: text("job_description"),
  salaryMin: integer("salary_min"),
  salaryMax: integer("salary_max"),
  salaryText: text("salary_text"),
  matchScore: integer("match_score"),
  status: text("status").notNull().default("discovered"),
  approvalStatus: text("approval_status").notNull().default("pending"),
  applyAgentStatus: text("apply_agent_status"),
  roleFamily: text("role_family"),
  resumeAngle: text("resume_angle"),
  isSample: boolean("is_sample").notNull().default(false),
  tailoredResumeSlug: text("tailored_resume_slug"),
  tailoredResumeFileName: text("tailored_resume_file_name"),
  tailoredResumeGeneratedAt: timestamp("tailored_resume_generated_at", {
    withTimezone: true,
  }),
  tailoringPlan: jsonb("tailoring_plan").$type<TailoringPlan>(),
  resumeCoverageScore: integer("resume_coverage_score"),
  applicationPromptsScannedAt: timestamp("application_prompts_scanned_at", {
    withTimezone: true,
  }),
  applyReviewConfirmed: boolean("apply_review_confirmed")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export const applicationQuestions = pgTable("application_questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  answer: text("answer"),
  status: text("status").notNull().default("needs_draft"),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export const agentRunQueue = pgTable("agent_run_queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  runType: text("run_type").notNull().default("application"),
  status: text("status").notNull().default("queued"),
  brief: text("brief"),
  submitAuthorized: boolean("submit_authorized").notNull().default(false),
  companySnapshot: text("company_snapshot"),
  titleSnapshot: text("title_snapshot"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  resultSummary: text("result_summary"),
  error: text("error"),
}).enableRLS();

export type EducationEntry = { school: string; degree: string };

export type SearchCriteria = {
  roleFamilies: string[];
  locations: string[];
  salaryFloor?: number;
  industries: string[];
};

/** Singleton row: candidate profile, work-auth defaults, and search criteria. */
export const candidateProfile = pgTable("candidate_profile", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  linkedin: text("linkedin"),
  location: text("location"),
  currentCompany: text("current_company"),
  functionTags: jsonb("function_tags").$type<string[]>().notNull().default([]),
  preferredIndustries: jsonb("preferred_industries")
    .$type<string[]>()
    .notNull()
    .default([]),
  workAuthorized: boolean("work_authorized").notNull().default(true),
  requiresSponsorship: boolean("requires_sponsorship")
    .notNull()
    .default(false),
  education: jsonb("education").$type<EducationEntry[]>().notNull().default([]),
  searchCriteria: jsonb("search_criteria").$type<SearchCriteria>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export type ResumeBullet = {
  id: string;
  text: string;
  keywords: string[];
  synonyms: Record<string, string[]>;
};

export type ResumeExperienceEntry = {
  company: string;
  role: string;
  team?: string;
  location?: string;
  dateRange: string;
  bullets: ResumeBullet[];
};

export type ResumeData = {
  name: string;
  contactLine: string;
  education: EducationEntry[];
  experience: ResumeExperienceEntry[];
  projects: {
    name: string;
    org?: string;
    dateRange: string;
    bullets: string[];
  }[];
  skills: { category: string; items: string[] }[];
  certifications: string[];
};

/** Singleton row: the base resume, as structured data (not a static file). */
export const resumeProfile = pgTable("resume_profile", {
  id: uuid("id").defaultRandom().primaryKey(),
  data: jsonb("data").$type<ResumeData>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export const storyBankEntries = pgTable("story_bank_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

/**
 * Suggestions from the Job Search Agent — deliberately NOT the `jobs` table.
 * A web-search-backed LLM can surface stale postings or wrong details, so
 * results land here for human review and require an explicit "Promote to
 * pipeline" action before becoming a real tracked job.
 */
export const jobSearchSuggestions = pgTable("job_search_suggestions", {
  id: uuid("id").defaultRandom().primaryKey(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  location: text("location"),
  workMode: text("work_mode"),
  applyUrl: text("apply_url"),
  sourceUrl: text("source_url"),
  salaryText: text("salary_text"),
  matchScore: integer("match_score"),
  rationale: text("rationale"),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export type Job = typeof jobs.$inferSelect;
export type ApplicationQuestion = typeof applicationQuestions.$inferSelect;
export type AgentRunQueueItem = typeof agentRunQueue.$inferSelect;
export type CandidateProfile = typeof candidateProfile.$inferSelect;
export type ResumeProfile = typeof resumeProfile.$inferSelect;
export type StoryBankEntry = typeof storyBankEntries.$inferSelect;
export type JobSearchSuggestion = typeof jobSearchSuggestions.$inferSelect;
