import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { candidateProfile, jobSearchSuggestions, jobs } from "@/lib/db/schema";
import { findJobCandidates } from "@/lib/search/job-search-agent";
import { isLikelyClosed } from "@/lib/search/freshness-check";
import { looksLikeGenericCareersPage } from "@/lib/search/specificity-check";
import { isBlockedSource } from "@/lib/search/blocked-sources";

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
  let filteredClosed = 0;
  let filteredGeneric = 0;
  let filteredBlockedSource = 0;

  // Deterministic backstops on top of the agent's own instructions:
  // 1. Actually fetch each candidate's apply page and look for
  //    "closed"/"filled" wording, since web search results (especially
  //    aggregator mirrors) can be stale. A fetch failure or ambiguous page
  //    defaults to "keep it" — this only filters out postings it's
  //    confident are dead.
  // 2. Reject applyUrls that are just a generic careers/jobs landing page
  //    (no job ID or role-specific slug) — a real case surfaced one of
  //    these ("snorkel.ai/join-us/") that didn't actually take the user to
  //    the specific role it claimed to be for.
  // 3. Reject known paywalled-application sources (e.g. TheLadders'
  //    "Apply4Me" upsell) regardless of what the model returns.
  const closedChecks = await Promise.all(
    candidates.map((c) => isLikelyClosed(c.applyUrl, c.title))
  );

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (isBlockedSource(candidate.applyUrl)) {
      filteredBlockedSource++;
      continue;
    }
    if (looksLikeGenericCareersPage(candidate.applyUrl)) {
      filteredGeneric++;
      continue;
    }
    if (closedChecks[i]) {
      filteredClosed++;
      continue;
    }
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
    filteredClosed,
    filteredGeneric,
    filteredBlockedSource,
    warning,
    suggestions,
  });
}
