import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { candidateProfile, jobSearchSuggestions, jobs } from "@/lib/db/schema";
import { findJobCandidates, type JobCandidate } from "@/lib/search/job-search-agent";
import { isLikelyBotBlocked, isLikelyClosed } from "@/lib/search/freshness-check";
import { looksLikeGenericCareersPage } from "@/lib/search/specificity-check";
import { isBlockedSource } from "@/lib/search/blocked-sources";
import { findDirectSourceUrl } from "@/lib/search/find-direct-source";

function normalize(company: string, title: string): string {
  return `${company}|${title}`.toLowerCase().replace(/\s+/g, " ").trim();
}

type CheckResult =
  | { ok: true }
  | { ok: false; reason: "blocked" | "generic" | "closed" | "unverifiable" };

async function checkCandidateUrl(url: string, title: string): Promise<CheckResult> {
  if (isBlockedSource(url)) return { ok: false, reason: "blocked" };
  if (looksLikeGenericCareersPage(url)) return { ok: false, reason: "generic" };
  if (await isLikelyClosed(url, title)) return { ok: false, reason: "closed" };
  // Bot-protection (403/429/503) means we couldn't actually verify the page
  // at all — not evidence it's open. Confirmed real case: OpenAI's
  // Cloudflare challenge blocked our check on a posting whose real,
  // browser-rendered page was a genuine 404. Route it through the same
  // recovery attempt as a closed/generic/blocked link rather than silently
  // trusting an unverifiable result.
  if (await isLikelyBotBlocked(url)) return { ok: false, reason: "unverifiable" };
  return { ok: true };
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
  let recovered = 0;
  let filteredClosed = 0;
  let filteredGeneric = 0;
  let filteredBlockedSource = 0;
  let filteredUnverifiable = 0;

  // Deterministic backstops on top of the agent's own instructions:
  // 1. Actually fetch each candidate's apply page and look for
  //    "closed"/"filled" wording (plus a title-mention check), since web
  //    search results (especially aggregator mirrors) can be stale.
  // 2. Reject applyUrls that are just a generic careers/jobs landing page.
  // 3. Reject known paywalled-application sources (e.g. TheLadders'
  //    "Apply4Me" upsell).
  // When a candidate fails any of these, it gets one recovery attempt: a
  // targeted follow-up search for the same role directly on the company's
  // own careers page/ATS, re-validated through the same checks, rather than
  // dropping a possibly-good match just because the first link was bad.
  const initialChecks = await Promise.all(
    candidates.map((c) => checkCandidateUrl(c.applyUrl, c.title))
  );

  for (let i = 0; i < candidates.length; i++) {
    let candidate: JobCandidate = candidates[i];
    let check = initialChecks[i];

    if (!check.ok) {
      const directUrl = await findDirectSourceUrl({
        company: candidate.company,
        title: candidate.title,
      });
      if (directUrl) {
        const recheck = await checkCandidateUrl(directUrl, candidate.title);
        if (recheck.ok) {
          candidate = { ...candidate, applyUrl: directUrl, sourceUrl: directUrl };
          check = recheck;
          recovered++;
        }
      }
    }

    if (!check.ok) {
      if (check.reason === "blocked") filteredBlockedSource++;
      else if (check.reason === "generic") filteredGeneric++;
      else if (check.reason === "unverifiable") filteredUnverifiable++;
      else filteredClosed++;
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
    recovered,
    filteredClosed,
    filteredGeneric,
    filteredBlockedSource,
    filteredUnverifiable,
    warning,
    suggestions,
  });
}
