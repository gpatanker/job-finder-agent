CREATE TABLE "agent_run_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"run_type" text DEFAULT 'application' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"brief" text,
	"submit_authorized" boolean DEFAULT false NOT NULL,
	"company_snapshot" text,
	"title_snapshot" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result_summary" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "application_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"answer" text,
	"status" text DEFAULT 'needs_draft' NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"team" text,
	"location" text,
	"work_mode" text,
	"source_platform" text,
	"apply_url" text,
	"job_description" text,
	"salary_min" integer,
	"salary_max" integer,
	"salary_text" text,
	"match_score" integer,
	"status" text DEFAULT 'discovered' NOT NULL,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"apply_agent_status" text,
	"role_family" text,
	"resume_angle" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"tailored_resume_slug" text,
	"tailored_resume_file_name" text,
	"tailored_resume_generated_at" timestamp with time zone,
	"application_prompts_scanned_at" timestamp with time zone,
	"apply_review_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_run_queue" ADD CONSTRAINT "agent_run_queue_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_questions" ADD CONSTRAINT "application_questions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;