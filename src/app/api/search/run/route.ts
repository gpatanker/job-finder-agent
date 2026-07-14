import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { candidateProfile, jobSearchSuggestions, jobs } from "@/lib/db/schema";
import { findJobCandidates } from "@/lib/search/job-search-agent";

function normalize(company: string, title: string): string {
  return `${company}|${title}`.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function POST() {
  const [profile] = await db.select().from(candidateProfile).limit(1);
  if (!profile) {
    return NextResponse.json(
      {
        error:
          "No candidate profile seeded yet. Fill in local/profile.seed.json and run `npm run db:seed-profile`, or add one in Settings.",
      },
      { status: 400 }
    );
  }

  const [existingJobs, existingSuggestions] = await Promise.all([
    db.select({ company: jobs.company, title: jobs.title }).from(jobs),
    db
      .select({ company: jobSearchSuggestions.company, title: jobSearchSuggestions.title })
      .from(jobSearchSuggestions)
      .where(eq(jobSearchSuggestions.status, "new")),
  ]);

  const { candidates, warning } = await findJobCandidates({
    profile,
    knownJobs: [...existingJobs, ...existingSuggestions],
  });

  const knownKeys = new Set(
    [...existingJobs, ...existingSuggestions].map((j) => normalize(j.company, j.title))
  );

  let added = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const key = normalize(candidate.company, candidate.title);
    if (knownKeys.has(key)) {
      skipped++;
      continue;
    }
    await db.insert(jobSearchSuggestions).values({
      company: candidate.company,
      title: candidate.title,
      location: candidate.location,
      workMode: candidate.workMode,
      applyUrl: candidate.applyUrl,
      sourceUrl: candidate.sourceUrl,
      salaryText: candidate.salaryText,
      matchScore: candidate.matchScore,
      rationale: candidate.rationale,
    });
    knownKeys.add(key);
    added++;
  }

  const suggestions = await db
    .select()
    .from(jobSearchSuggestions)
    .where(eq(jobSearchSuggestions.status, "new"));

  return NextResponse.json({
    found: candidates.length,
    added,
    skipped,
    warning,
    suggestions,
  });
}
