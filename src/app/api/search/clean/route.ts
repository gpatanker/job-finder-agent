import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobSearchSuggestions } from "@/lib/db/schema";
import { checkCandidateUrl } from "@/lib/search/validate-candidate";
import { findDirectSourceUrl } from "@/lib/search/find-direct-source";

/**
 * Re-validates every currently-suggested ("new") job posting against the
 * same checks applied to brand-new candidates (api/search/run) — postings
 * can go stale, get taken down, or turn out to be behind a paywall/bot
 * wall sometime *after* being suggested, and this list was never
 * re-checked once inserted. Marks failures "stale" (distinct from
 * user-driven "dismissed", so it's clear *why* something disappeared) and
 * gives each failure the same one-shot recovery attempt used elsewhere
 * before giving up on it.
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

  for (const s of suggestions) {
    if (!s.applyUrl) {
      kept++;
      continue;
    }

    let check = await checkCandidateUrl(s.applyUrl, s.title);
    let recoveredUrl: string | null = null;

    if (!check.ok) {
      const directUrl = await findDirectSourceUrl({ company: s.company, title: s.title });
      if (directUrl) {
        const recheck = await checkCandidateUrl(directUrl, s.title);
        if (recheck.ok) {
          check = recheck;
          recoveredUrl = directUrl;
          recovered++;
        }
      }
    }

    if (!check.ok) {
      reasons[check.reason]++;
      removed++;
      await db
        .update(jobSearchSuggestions)
        .set({ status: "stale", updatedAt: new Date() })
        .where(eq(jobSearchSuggestions.id, s.id));
      continue;
    }

    if (recoveredUrl) {
      await db
        .update(jobSearchSuggestions)
        .set({ applyUrl: recoveredUrl, sourceUrl: recoveredUrl, updatedAt: new Date() })
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
