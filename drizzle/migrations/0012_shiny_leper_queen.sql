CREATE TABLE "company_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_key" text NOT NULL,
	"company_name" text NOT NULL,
	"summary" text NOT NULL,
	"domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valued_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_cost_usd" double precision,
	"researched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_profiles_company_key_unique" UNIQUE("company_key")
);
--> statement-breakpoint
ALTER TABLE "company_profiles" ENABLE ROW LEVEL SECURITY;