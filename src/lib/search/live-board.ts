import { extractGreenhouseIds } from "@/lib/scraping/greenhouse";
import { textMentionsTitle } from "./freshness-check";

const USER_AGENT = "Mozilla/5.0 (compatible; JobFinderAgent/1.0; +personal job application tracker)";
const FETCH_TIMEOUT_MS = 8000;

export type AtsBoard =
  | { platform: "greenhouse"; boardToken: string }
  | { platform: "ashby"; orgSlug: string };

export type LiveBoardJob = { title: string; url: string };

/**
 * Pure URL parsing, no network — figures out which ATS a candidate's own
 * apply URL belongs to and what board/org identifier to query, straight
 * from the link itself. Reuses the same Greenhouse token/job-id regex the
 * scraper already relies on so the two never drift apart.
 */
export function detectAtsBoard(url: string): AtsBoard | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();

  if (host === "job-boards.greenhouse.io" || host === "boards.greenhouse.io") {
    const ids = extractGreenhouseIds(url);
    if (!ids) return null;
    return { platform: "greenhouse", boardToken: ids.boardToken };
  }

  if (host === "jobs.ashbyhq.com") {
    const [orgSlug] = parsed.pathname.split("/").filter(Boolean);
    if (!orgSlug) return null;
    return { platform: "ashby", orgSlug };
  }

  return null;
}

type GreenhouseJobsResponse = {
  jobs?: { title?: string; absolute_url?: string }[];
};

type AshbyJobsResponse = {
  jobs?: { title?: string; jobUrl?: string; applyUrl?: string }[];
};

/**
 * Fetches a company's full current job list directly from their ATS's
 * public, unauthenticated job-board API — the live source of truth, not a
 * crawled copy, so it's fresh by construction. Any non-ok response,
 * unexpected shape, or thrown error fails open (returns null) rather than
 * being mistaken for "company has zero open roles" — callers should fall
 * back to the existing per-URL freshness check in that case, not treat it
 * as evidence of closure.
 */
export async function fetchLiveBoardJobs(board: AtsBoard): Promise<LiveBoardJob[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    if (board.platform === "greenhouse") {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${board.boardToken}/jobs`,
        { signal: controller.signal, headers: { "User-Agent": USER_AGENT } }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as GreenhouseJobsResponse;
      const jobs = (data.jobs ?? [])
        .filter((j): j is { title: string; absolute_url: string } => Boolean(j.title && j.absolute_url))
        .map((j) => ({ title: j.title, url: j.absolute_url }));
      return jobs;
    }

    const res = await fetch(
      `https://api.ashbyhq.com/posting-api/job-board/${board.orgSlug}`,
      { signal: controller.signal, headers: { "User-Agent": USER_AGENT } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as AshbyJobsResponse;
    const jobs = (data.jobs ?? [])
      .map((j) => ({ title: j.title, url: j.jobUrl ?? j.applyUrl }))
      .filter((j): j is { title: string; url: string } => Boolean(j.title && j.url));
    return jobs;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Finds the candidate's role in a company's live job list — reusing the
 * same fuzzy word-overlap matcher already used (and tested) for the
 * per-page title check, so a lightly reworded/renamed posting still
 * matches instead of being wrongly flagged closed.
 */
export function matchLiveJob(jobs: LiveBoardJob[], title: string): LiveBoardJob | null {
  for (const job of jobs) {
    if (textMentionsTitle(job.title, title)) return job;
  }
  return null;
}

const EMBED_SCRIPT_TOKEN_REGEX = /greenhouse\.io\/embed\/job_board\/js\?for=([a-zA-Z0-9_-]+)/i;

export type EmbeddedGreenhouseJob = { platform: "greenhouse"; boardToken: string; jobId: string };

/**
 * Some companies embed Greenhouse's job-board widget directly on their own
 * domain — `<script src="https://greenhouse.io/embed/job_board/js?for={token}">`
 * — and identify the specific role via a `gh_jid` query param on their own
 * page URL (e.g. `buildops.com/careers/job-application?gh_jid=6100196004`)
 * rather than Greenhouse's own `job-boards.greenhouse.io/{token}/jobs/{id}`
 * path shape, which `detectAtsBoard` doesn't recognize. The embed script's
 * `for=` parameter reveals the real board token even though the rest of the
 * page (including the job title) only renders client-side — confirmed real
 * case: BuildOps. Requires one fetch (there's no way to know the board
 * token from the URL alone), so this is a fallback tried only when the URL
 * carries a `gh_jid` and the fast, no-network `detectAtsBoard` came back
 * empty. Fails open (returns null) on any fetch error or missing token —
 * callers should fall back to the existing per-page checks in that case.
 */
export async function detectEmbeddedGreenhouseBoard(url: string): Promise<EmbeddedGreenhouseJob | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const jobId = parsed.searchParams.get("gh_jid");
  if (!jobId) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(EMBED_SCRIPT_TOKEN_REGEX);
    if (!match) return null;
    return { platform: "greenhouse", boardToken: match[1], jobId };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type GreenhouseSingleJobResponse = { title?: string; absolute_url?: string };

export type GreenhouseJobLookup =
  | { status: "found"; job: LiveBoardJob }
  | { status: "closed" }
  | { status: "error" };

/**
 * Looks up one specific job by ID directly — more precise than fetching the
 * whole board and fuzzy-matching by title (used when the job ID is already
 * known, e.g. from a `gh_jid` embed), since it confirms the exact posting
 * rather than the closest-sounding title. Distinguishes a confirmed-gone
 * 404 (`"closed"` — as authoritative as this gets, safe to skip any LLM
 * recovery) from a genuine fetch failure (`"error"` — couldn't determine
 * either way, callers should fall back to the existing per-page checks
 * rather than treating it as closed).
 */
export async function fetchGreenhouseJobById(
  boardToken: string,
  jobId: string
): Promise<GreenhouseJobLookup> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${jobId}`,
      { signal: controller.signal, headers: { "User-Agent": USER_AGENT } }
    );
    if (res.status === 404) return { status: "closed" };
    if (!res.ok) return { status: "error" };
    const data = (await res.json()) as GreenhouseSingleJobResponse;
    if (!data.title || !data.absolute_url) return { status: "error" };
    return { status: "found", job: { title: data.title, url: data.absolute_url } };
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timeout);
  }
}
