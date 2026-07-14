ALTER TABLE "candidate_profile" ADD COLUMN "disability_status" text;--> statement-breakpoint
ALTER TABLE "candidate_profile" ADD COLUMN "zip_code" text;--> statement-breakpoint
ALTER TABLE "candidate_profile" ADD COLUMN "highest_education_level" text;--> statement-breakpoint
ALTER TABLE "candidate_profile" ADD COLUMN "requires_relocation_assistance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_profile" ADD COLUMN "how_heard_default" text;--> statement-breakpoint
ALTER TABLE "candidate_profile" ADD COLUMN "ai_policy_agreement" text;