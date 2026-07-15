CREATE TABLE "question_bank_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "question_bank_entries" ENABLE ROW LEVEL SECURITY;