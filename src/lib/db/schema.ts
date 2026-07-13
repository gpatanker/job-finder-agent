import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

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
});

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
});

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
});
