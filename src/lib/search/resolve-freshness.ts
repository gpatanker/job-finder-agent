import { checkCandidateUrl, type CandidateCheckResult } from "./validate-candidate";
import { findDirectSourceUrl } from "./find-direct-source";
import {
  detectAtsBoard,
  detectEmbeddedGreenhouseBoard,
  fetchGreenhouseJobById,
  fetchLiveBoardJobs,
  matchLiveJob,
  type LiveBoardJob,
} from "./live-board";

export type ResolveResult =
  | { ok: true; applyUrl: string; sourceUrl: string; recovered: boolean; verifiedLive: boolean }
  | { ok: false; reason: Extract<CandidateCheckResult, { ok: false }>["reason"] };

/**
 * Caches the in-flight/resolved fetch per board (not per candidate) so
 * multiple candidates from the same company in one run share a single
 * live-board fetch instead of each re-fetching it. Cache the promise
 * itself, not just the resolved value, so concurrent callers (this is
 * invoked from a Promise.all) await the same in-flight request rather than
 * racing duplicate fetches.
 */
export type LiveBoardCache = Map<string, Promise<LiveBoardJob[] | null>>;

function boardCacheKey(board: ReturnType<typeof detectAtsBoard>): string {
  if (!board) return "";
  return board.platform === "greenhouse" ? `greenhouse:${board.boardToken}` : `ashby:${board.orgSlug}`;
}

async function getLiveBoardJobs(
  board: NonNullable<ReturnType<typeof detectAtsBoard>>,
  cache: LiveBoardCache
): Promise<LiveBoardJob[] | null> {
  const key = boardCacheKey(board);
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = fetchLiveBoardJobs(board);
  cache.set(key, promise);
  return promise;
}

/**
 * Verifies a candidate's freshness. For a company on Greenhouse or Ashby
 * (detectable straight from the URL), this checks the company's live,
 * unauthenticated job-board API directly — the source of truth, not a
 * crawled snapshot — instead of paying for an LLM to search the web again.
 * A match (including a lightly renamed/reposted title, via the same fuzzy
 * matcher used elsewhere) confirms the posting is genuinely open right
 * now; no match is treated as closed directly, with no LLM recovery call,
 * since the live board is authoritative and re-searching can't produce a
 * different truth. A second tier handles companies that embed Greenhouse's
 * widget on their own domain (identified by a `gh_jid` query param, e.g.
 * buildops.com/careers/job-application?gh_jid=...) rather than linking
 * directly to job-boards.greenhouse.io — the embed script's own `for=`
 * parameter reveals the real board token, and since the exact job ID is
 * already known from the URL, this looks up that one job directly rather
 * than fuzzy-matching by title. Falls back to the existing
 * checkCandidateUrl + findDirectSourceUrl pipeline, unchanged, when neither
 * tier can detect a board or a live-board fetch itself fails (network
 * hiccup) — so behavior for any other ATS/platform is identical to today.
 */
export async function resolveCandidateFreshness(params: {
  applyUrl: string;
  sourceUrl: string;
  title: string;
  company: string;
  liveBoardCache: LiveBoardCache;
}): Promise<ResolveResult> {
  const { applyUrl, sourceUrl, title, company, liveBoardCache } = params;

  const board = detectAtsBoard(applyUrl);
  if (board) {
    const jobs = await getLiveBoardJobs(board, liveBoardCache);
    if (jobs) {
      const match = matchLiveJob(jobs, title);
      if (match) {
        return {
          ok: true,
          applyUrl: match.url,
          sourceUrl: match.url,
          recovered: match.url !== applyUrl,
          verifiedLive: true,
        };
      }
      return { ok: false, reason: "closed" };
    }
    // Live-board fetch itself failed (network hiccup) — fall through below.
  } else {
    const embedded = await detectEmbeddedGreenhouseBoard(applyUrl);
    if (embedded) {
      const lookup = await fetchGreenhouseJobById(embedded.boardToken, embedded.jobId);
      if (lookup.status === "found") {
        return {
          ok: true,
          applyUrl: lookup.job.url,
          sourceUrl: lookup.job.url,
          recovered: lookup.job.url !== applyUrl,
          verifiedLive: true,
        };
      }
      if (lookup.status === "closed") {
        return { ok: false, reason: "closed" };
      }
      // lookup.status === "error" (network hiccup) — fall through below.
    }
  }

  const check = await checkCandidateUrl(applyUrl, title);
  if (check.ok) {
    return { ok: true, applyUrl, sourceUrl, recovered: false, verifiedLive: false };
  }

  const directUrl = await findDirectSourceUrl({ company, title });
  if (directUrl) {
    const recheck = await checkCandidateUrl(directUrl, title);
    if (recheck.ok) {
      return { ok: true, applyUrl: directUrl, sourceUrl: directUrl, recovered: true, verifiedLive: false };
    }
  }

  return { ok: false, reason: check.reason };
}
