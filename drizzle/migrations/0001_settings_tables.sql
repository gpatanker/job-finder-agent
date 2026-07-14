CREATE TABLE "candidate_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"linkedin" text,
	"location" text,
	"current_company" text,
	"function_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_industries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"work_authorized" boolean DEFAULT true NOT NULL,
	"requires_sponsorship" boolean DEFAULT false NOT NULL,
	"education" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_criteria" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resume_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "story_bank_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_bank_entries_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "story_bank_entries" ENABLE ROW LEVEL SECURITY;