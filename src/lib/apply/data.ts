import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { applicationQuestions, candidateProfile, platformFieldMappings } from "@/lib/db/schema";
import type { CandidateProfile } from "@/lib/db/schema";

export async function getCandidateProfileOrThrow(): Promise<CandidateProfile> {
  const [profile] = await db.select().from(candidateProfile).limit(1);
  if (!profile) {
    throw new Error(
      "No candidate profile seeded yet. Fill in local/profile.seed.json and run `npm run db:seed-profile`, or add one in Settings."
    );
  }
  return profile;
}

export async function getApprovedQuestions(jobId: string) {
  const questions = await db
    .select()
    .from(applicationQuestions)
    .where(eq(applicationQuestions.jobId, jobId));
  return questions.filter((q) => q.status === "approved" || q.status === "submitted");
}

export async function getFieldMappingsForPlatform(platform: string) {
  return db
    .select()
    .from(platformFieldMappings)
    .where(eq(platformFieldMappings.platform, platform));
}
