CREATE TABLE "job_search_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"work_mode" text,
	"apply_url" text,
	"source_url" text,
	"salary_text" text,
	"match_score" integer,
	"rationale" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_search_suggestions" ENABLE ROW LEVEL SECURITY;