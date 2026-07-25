CREATE TABLE "analyst_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_reason" text NOT NULL,
	"trigger_detail" text,
	"jobs_analyzed_count" integer NOT NULL,
	"model" text NOT NULL,
	"summary" text NOT NULL,
	"recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_cost_usd" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyst_reports" ENABLE ROW LEVEL SECURITY;