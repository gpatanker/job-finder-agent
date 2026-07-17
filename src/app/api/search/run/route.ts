import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { candidateProfile, jobSearchSuggestions, jobs } from "@/lib/db/schema";
import { findJobCandidates, type JobCandidate } from "@/lib/search/job-search-agent";
import { checkCandidateUrl } from "@/lib/search/validate-candidate";
import { findDirectSourceUrl } from "@/lib/search/find-direct-source";

const TARGET_NEW_SUGGESTIONS = 20;
const MAX_WIDEN_PASSES = 1;
const MAX_NEW_SUGGESTIONS_PER_COMPANY = 2;

function normalize(company: string, title: string): string {
  return `${company}|${title}`.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Canonical form of an apply URL for dedup — catches the same posting found twice via cosmetically different links (e.g. with/without a `?gh_jid=` tracking param), which company+title text alone can miss if the LLM phrases the title slightly differently each time. */
function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return null;
  }
}

type RunState = {
  knownKeys: Set<string>;
  knownUrlKeys: Set<string>;
  companyCountThisRun: Map<string, number>;
  added: number;
  skipped: number;
  recovered: number;
  filteredClosed: number;
  filteredGeneric: number;
  filteredBlockedSource: number;
  filteredUnverifiable: number;
  filteredDiversityCap: number;
};

/**
 * Deterministic backstops on top of the agent's own instructions:
 * 1. Actually fetch each candidate's apply page and look for "closed"/
 *    "filled" wording (plus a title-mention check) or bot-blocking, since
 *    web search results (especially aggregator mirrors) can be stale.
 * 2. Reject applyUrls that are just a generic careers/jobs landing page.
 * 3. Reject known paywalled/excluded sources.
 * 4. Cap new suggestions per company per run so one prolific company
 *    doesn't crowd out diversity across a single search.
 * When a candidate fails the URL checks, it gets one recovery attempt: a
 * targeted follow-up search for the same role directly on the company's
 * own careers page/ATS, re-validated through the same checks, rather than
 * dropping a possibly-good match just because the first link was bad.
 */
async function processCandidates(candidates: JobCandidate[], state: RunState): Promise<void> {
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
          state.recovered++;
        }
      }
    }

    if (!check.ok) {
      if (check.reason === "blocked") state.filteredBlockedSource++;
      else if (check.reason === "generic") state.filteredGeneric++;
      else if (check.reason === "unverifiable") state.filteredUnverifiable++;
      else state.filteredClosed++;
      continue;
    }

    const key = normalize(candidate.company, candidate.title);
    const urlKey = normalizeUrl(candidate.applyUrl);
    if (state.knownKeys.has(key) || (urlKey && state.knownUrlKeys.has(urlKey))) {
      state.skipped++;
      continue;
    }

    const companyKey = candidate.company.trim().toLowerCase();
    const countSoFar = state.companyCountThisRun.get(companyKey) ?? 0;
    if (countSoFar >= MAX_NEW_SUGGESTIONS_PER_COMPANY) {
      state.filteredDiversityCap++;
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
    state.knownKeys.add(key);
    if (urlKey) state.knownUrlKeys.add(urlKey);
    state.companyCountThisRun.set(companyKey, countSoFar + 1);
    state.added++;
  }
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

  // Deliberately NOT filtered by status: a suggestion the user already
  // dismissed (or promoted, or that went stale) must stay excluded from
  // future runs forever, not just while it's still sitting as "new" —
  // otherwise a dismissed posting gets silently re-suggested by the very
  // next search, which is exactly what real data showed was happening
  // (the same company+title re-appearing as "new" days after being
  // dismissed, sometimes more than once).
  const [existingJobs, existingSuggestions] = await Promise.all([
    db.select({ company: jobs.company, title: jobs.title, applyUrl: jobs.applyUrl }).from(jobs),
    db
      .select({
        company: jobSearchSuggestions.company,
        title: jobSearchSuggestions.title,
        applyUrl: jobSearchSuggestions.applyUrl,
      })
      .from(jobSearchSuggestions),
  ]);

  const allKnown = [...existingJobs, ...existingSuggestions];
  const state: RunState = {
    knownKeys: new Set(allKnown.map((j) => normalize(j.company, j.title))),
    knownUrlKeys: new Set(
      allKnown.map((j) => (j.applyUrl ? normalizeUrl(j.applyUrl) : null)).filter((k): k is string => !!k)
    ),
    companyCountThisRun: new Map(),
    added: 0,
    skipped: 0,
    recovered: 0,
    filteredClosed: 0,
    filteredGeneric: 0,
    filteredBlockedSource: 0,
    filteredUnverifiable: 0,
    filteredDiversityCap: 0,
  };

  let knownJobs = allKnown.map((j) => ({ company: j.company, title: j.title }));
  const { candidates, warning: firstWarning } = await findJobCandidates({ profile, knownJobs });
  let found = candidates.length;
  await processCandidates(candidates, state);

  // If the run came back thin, keep running broadening follow-up passes
  // rather than accepting a near-empty result — real case: a narrow
  // industries list ("AI infrastructure", famous AI labs) had already been
  // substantially covered by prior runs, so a plain repeat search mostly
  // just re-found already-known postings. Each pass's known-jobs list
  // includes everything added by every prior pass this run, so later
  // passes don't re-suggest earlier finds. Bounded by MAX_WIDEN_PASSES so
  // a genuinely exhausted market doesn't spin forever burning API calls.
  let widenPasses = 0;
  let lastWarning = firstWarning;
  while (state.added < TARGET_NEW_SUGGESTIONS && widenPasses < MAX_WIDEN_PASSES) {
    widenPasses++;
    const newlyKnown = await db
      .select({ company: jobSearchSuggestions.company, title: jobSearchSuggestions.title })
      .from(jobSearchSuggestions);
    knownJobs = [
      ...existingJobs.map((j) => ({ company: j.company, title: j.title })),
      ...newlyKnown,
    ];
    const widenResult = await findJobCandidates({ profile, knownJobs, broaden: true });
    found += widenResult.candidates.length;
    lastWarning = widenResult.warning ?? lastWarning;
    const addedBefore = state.added;
    await processCandidates(widenResult.candidates, state);
    // Stop widening once a pass adds nothing new — the market's exhausted
    // for this run, not just thin, so further passes would just burn calls.
    if (state.added === addedBefore) break;
  }

  const suggestions = await db
    .select()
    .from(jobSearchSuggestions)
    .where(eq(jobSearchSuggestions.status, "new"));

  return NextResponse.json({
    found,
    added: state.added,
    skipped: state.skipped,
    recovered: state.recovered,
    filteredClosed: state.filteredClosed,
    filteredGeneric: state.filteredGeneric,
    filteredBlockedSource: state.filteredBlockedSource,
    filteredUnverifiable: state.filteredUnverifiable,
    filteredDiversityCap: state.filteredDiversityCap,
    widened: widenPasses > 0,
    widenPasses,
    warning: lastWarning,
    suggestions,
  });
}
