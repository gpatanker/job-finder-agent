import { isLikelyBotBlocked, isLikelyClosed } from "./freshness-check";
import { looksLikeGenericCareersPage } from "./specificity-check";
import { isBlockedSource } from "./blocked-sources";

export type CandidateCheckResult =
  | { ok: true }
  | { ok: false; reason: "blocked" | "generic" | "closed" | "unverifiable" };

/**
 * Shared validation pipeline for a candidate job-posting URL — used both
 * when the Job Search Agent finds new candidates (api/search/run) and when
 * re-validating already-suggested postings (api/search/clean), so both
 * paths apply identical, single-sourced checks rather than drifting apart.
 */
export async function checkCandidateUrl(url: string, title: string): Promise<CandidateCheckResult> {
  if (isBlockedSource(url)) return { ok: false, reason: "blocked" };
  if (looksLikeGenericCareersPage(url)) return { ok: false, reason: "generic" };
  if (await isLikelyClosed(url, title)) return { ok: false, reason: "closed" };
  // Bot-protection (403/429/503) means we couldn't actually verify the page
  // at all — not evidence it's open. See freshness-check.ts for the real
  // case (OpenAI's Cloudflare challenge) that motivated this.
  if (await isLikelyBotBlocked(url)) return { ok: false, reason: "unverifiable" };
  return { ok: true };
}
