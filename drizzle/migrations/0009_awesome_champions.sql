CREATE TABLE "llm_usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_site" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"request_count" integer DEFAULT 1 NOT NULL,
	"estimated_cost_usd" double precision NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_usage_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_run_queue" ADD COLUMN "required_manual_input" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "block_reason" text;--> statement-breakpoint
ALTER TABLE "question_bank_entries" ADD COLUMN "hit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "question_bank_entries" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "llm_usage_log" ADD CONSTRAINT "llm_usage_log_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;