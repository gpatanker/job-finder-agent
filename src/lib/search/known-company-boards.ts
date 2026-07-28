import { textMentionsTitle } from "./freshness-check";
import { detectAtsBoard, fetchLiveBoardJobs, type AtsBoard, type LiveBoardJob } from "./live-board";
import { isOverSeniorTitle, type JobCandidate } from "./job-search-agent";

/**
 * Zero-Perplexity-cost discovery channel: for every company we already have
 * a Greenhouse/Ashby apply link for (from prior jobs/suggestions), poll that
 * company's own live board API directly and look for any currently-open
 * role that matches the target role families. Fresh by construction — no
 * freshness verification needed downstream, it's already the live board —
 * and free, since it's a direct fetch to the ATS's public API rather than a
 * paid search request. Flagged by the 2026-07-27 search-yield diagnostic as
 * the single highest-ROI addition: the candidate already has 90+ known
 * companies with resolvable board tokens, each one a free "did they post
 * anything new" check.
 */

function boardKey(board: AtsBoard): string {
  return board.platform === "greenhouse" ? `greenhouse:${board.boardToken}` : `ashby:${board.orgSlug}`;
}

/** Loose but bounded: matches if the live job's title reasonably overlaps any target role phrase, in either direction (same rationale as matchLiveJob). */
function titleMatchesAnyRole(jobTitle: string, rolePhrases: string[]): boolean {
  return rolePhrases.some(
    (phrase) => textMentionsTitle(jobTitle, phrase) || textMentionsTitle(phrase, jobTitle)
  );
}

function scoreLiveBoardMatch(jobTitle: string, primaryRoleFamilies: string[]): number {
  let score = 55;
  const lower = jobTitle.toLowerCase();
  if (lower.includes("strategy") && lower.includes("operations")) score += 15;
  if (primaryRoleFamilies.some((f) => lower === f.toLowerCase())) score += 15;
  return Math.min(85, score);
}

/**
 * Distinct boards drawn from a list of (company, applyUrl) pairs — multiple
 * postings at the same company collapse to one board, one fetch.
 */
function distinctKnownBoards(
  known: { company: string; applyUrl: string | null }[]
): { company: string; board: AtsBoard }[] {
  const seen = new Map<string, { company: string; board: AtsBoard }>();
  for (const { company, applyUrl } of known) {
    if (!applyUrl) continue;
    const board = detectAtsBoard(applyUrl);
    if (!board) continue;
    const key = boardKey(board);
    if (!seen.has(key)) seen.set(key, { company, board });
  }
  return [...seen.values()];
}

export async function discoverFromKnownCompanyBoards(params: {
  known: { company: string; applyUrl: string | null }[];
  roleFamilies: string[];
}): Promise<JobCandidate[]> {
  const roleSynonyms = [
    ...params.roleFamilies,
    "Operations Manager",
    "Strategy and Operations Manager",
    "Revenue Operations Manager",
    "Technical Operations Manager",
    "Business Operations Analyst",
    "Business Operations Lead",
    "GTM Operations Manager",
    "Growth Operations Manager",
    "Partner Operations Manager",
  ];

  const boards = distinctKnownBoards(params.known);
  const results = await Promise.all(
    boards.map(async ({ company, board }) => {
      const jobs = await fetchLiveBoardJobs(board);
      return { company, jobs: jobs ?? [] };
    })
  );

  const candidates: JobCandidate[] = [];
  for (const { company, jobs } of results) {
    for (const job of jobs as LiveBoardJob[]) {
      if (isOverSeniorTitle(job.title)) continue;
      if (!titleMatchesAnyRole(job.title, roleSynonyms)) continue;
      candidates.push({
        company,
        title: job.title,
        applyUrl: job.url,
        sourceUrl: job.url,
        matchScore: scoreLiveBoardMatch(job.title, params.roleFamilies),
        rationale: `Found via a direct poll of ${company}'s live job board (not a search result) — title matches your target role family.`,
      });
    }
  }
  return candidates;
}
