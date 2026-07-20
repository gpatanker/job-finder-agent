import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobSearchSuggestions } from "@/lib/db/schema";
import { resolveCandidateFreshness, type LiveBoardCache } from "@/lib/search/resolve-freshness";

/**
 * Re-validates every currently-suggested ("new") job posting against the
 * same checks applied to brand-new candidates (api/search/run) — postings
 * can go stale, get taken down, or turn out to be behind a paywall/bot
 * wall sometime *after* being suggested, and this list was never
 * re-checked once inserted. Marks failures "stale" (distinct from
 * user-driven "dismissed", so it's clear *why* something disappeared).
 * Uses the same live-ATS-board check as api/search/run: a company on
 * Greenhouse or Ashby gets checked against its own current job list
 * directly (fresh by construction, no LLM call); anything else falls back
 * to the per-page check plus a one-shot recovery search, as before.
 */
export async function POST() {
  const suggestions = await db
    .select()
    .from(jobSearchSuggestions)
    .where(eq(jobSearchSuggestions.status, "new"));

  let removed = 0;
  let recovered = 0;
  let kept = 0;
  const reasons: Record<"closed" | "generic" | "blocked" | "unverifiable", number> = {
    closed: 0,
    generic: 0,
    blocked: 0,
    unverifiable: 0,
  };

  const liveBoardCache: LiveBoardCache = new Map();

  for (const s of suggestions) {
    if (!s.applyUrl) {
      kept++;
      continue;
    }

    const result = await resolveCandidateFreshness({
      applyUrl: s.applyUrl,
      sourceUrl: s.sourceUrl ?? s.applyUrl,
      title: s.title,
      company: s.company,
      liveBoardCache,
    });

    if (!result.ok) {
      reasons[result.reason]++;
      removed++;
      await db
        .update(jobSearchSuggestions)
        .set({ status: "stale", updatedAt: new Date() })
        .where(eq(jobSearchSuggestions.id, s.id));
      continue;
    }

    if (result.recovered) {
      recovered++;
      await db
        .update(jobSearchSuggestions)
        .set({ applyUrl: result.applyUrl, sourceUrl: result.sourceUrl, updatedAt: new Date() })
        .where(eq(jobSearchSuggestions.id, s.id));
    }
    kept++;
  }

  const remaining = await db
    .select()
    .from(jobSearchSuggestions)
    .where(eq(jobSearchSuggestions.status, "new"));

  return NextResponse.json({
    checked: suggestions.length,
    removed,
    recovered,
    kept,
    reasons,
    suggestions: remaining,
  });
}
