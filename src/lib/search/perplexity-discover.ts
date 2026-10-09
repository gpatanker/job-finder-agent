import type { CandidateProfile } from "@/lib/db/schema";
import { OPS_ROLE_SCOPE, type RoleScope } from "./role-scope";
import { estimatePerplexityCostUsd, logLlmUsage } from "@/lib/observability/llm-usage";

const PERPLEXITY_SEARCH_URL = "https://api.perplexity.ai/search";
// Raw search results, not chat-completion tokens — $5/1,000 requests flat,
// no per-token billing — so it's free to ask for the maximum per call, and
// firing more, shorter queries costs nothing extra per query.
const MAX_RESULTS_PER_QUERY = 20;
const MAX_TOKENS_PER_PAGE = 512;

/**
 * ATS hosts whose postings are deep-link-verifiable against a live,
 * unauthenticated board API (see live-board.ts) — pinning every discovery
 * query to these domains is what actually produces usable results.
 * Confirmed via live testing (2026-07-27): the same query text with no
 * domain filter returns ~85% board-landing-pages/blocked-aggregators/dead
 * scraper-mirror sites that can never pass specificity-check.ts or
 * blocked-sources.ts; with this filter applied, results are ~100% direct
 * job-ID deep links. Greenhouse/Ashby are the two live-board-verifiable
 * platforms today (resolve-freshness.ts); Lever/Rippling/SmartRecruiters/
 * Workable are included too since their deep links still pass the generic
 * checkCandidateUrl fallback even without live-board verification.
 */
export const ATS_DOMAIN_FILTER = [
  "job-boards.greenhouse.io",
  "boards.greenhouse.io",
  "jobs.ashbyhq.com",
  "jobs.lever.co",
  "ats.rippling.com",
  "jobs.smartrecruiters.com",
  "apply.workable.com",
];

/**
 * Rotating pool of short, single-intent role phrases. Short queries matter:
 * live testing showed a long query (joining every role family + every
 * location + every industry into one string) and a short query sharing the
 * same ATS domain filter returned ZERO overlapping results — length alone
 * determines what slice of the index comes back. Firing several short
 * queries therefore reaches much more of the index than one long one, and
 * rotating which ones run each time (see rotateSlice below) means a rerun
 * doesn't just re-fetch the previous run's near-identical result set.
 */
// The query-phrase pool now lives on the role scope (role-scope.ts) so it
// matches the candidate's actual function. It used to be a hardcoded list of
// operations titles, which meant a candidate in any other field paid for
// queries searching someone else's job: a product candidate measured 0 of 8
// queries mentioning "product" on one rotation step.

const ROLE_QUERIES_PER_RUN = 8;

export type DiscoveryResult = {
  combinedText: string;
  citations: string[];
  warning?: string;
};

type DiscoveryQuery = {
  query: string;
  /** Restricts results to these domains — applied to every query now. */
  domainFilter?: string[];
  /** Exact cutoff date (postings published on/after this date only). Mutually exclusive with recencyFilter. */
  afterDate?: string;
  /** Coarse recency bucket, used only as a cold-start fallback when no afterDate is available yet. */
  recencyFilter?: "day" | "week" | "month" | "year";
};

type PerplexitySearchResult = {
  title: string;
  url: string;
  snippet: string;
  date: string | null;
  last_updated: string | null;
};

/** MM/DD/YYYY, the format Perplexity's search_after_date_filter expects. */
function formatDateForPerplexity(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * How often the rotation advances. Rotation used to be keyed to the calendar
 * day, which quietly broke the common case of running the agent several times
 * a day: every run after the first fired byte-identical queries, so whether
 * anything new came back depended entirely on the search engine returning
 * different results for the same question. Measured against that, Perplexity
 * churned ~26% between runs and Exa ~11% — both leaving most of a rerun wasted.
 * A 15-minute bucket means consecutive runs draw genuinely different phrases
 * while still needing no persisted cursor and staying deterministic for tests.
 */
const ROTATION_BUCKET_MS = 15 * 60 * 1000;

/**
 * Draws slice number `sliceIndex` from the pool, advancing by a WHOLE slice
 * each step rather than by one position. Advancing by one position was the
 * other half of the problem: with 8 phrases per slice, the next offset shared 7
 * of its 8 phrases with the previous one, so even when rotation did fire it
 * barely changed the query set.
 */
function rotateSlice<T>(pool: readonly T[], count: number, sliceIndex: number): T[] {
  if (pool.length === 0) return [];
  const n = Math.min(count, pool.length);
  const offset = ((sliceIndex * n) % pool.length + pool.length) % pool.length;
  return Array.from({ length: n }, (_, i) => pool[(offset + i) % pool.length]);
}

/** Which rotation step this run is on. Overridable so tests can pin it. */
function currentRotationStep(seed?: number): number {
  return seed ?? Math.floor(Date.now() / ROTATION_BUCKET_MS);
}

/**
 * Builds the discovery query set for one pass. Every query now carries the
 * ATS domain filter (see ATS_DOMAIN_FILTER's comment for why) and is drawn
 * from a rotating pool rather than being a static, always-identical string.
 *
 * Two recency tracks instead of one blanket `search_recency_filter: "month"`:
 * - "Fresh" queries (role phrases) use an exact `search_after_date_filter`
 *   cutoff at the last known run date when available — a true incremental
 *   "what's appeared since we last looked" sweep, sharper than a coarse
 *   month bucket.
 * - "Backfill" queries (role phrases beyond the fresh slice, plus the fixed
 *   industry-context queries) carry no recency filter at all. Live testing
 *   showed dropping recency entirely surfaces meaningfully more still-open
 *   postings than the month filter allowed through — and staleness isn't a
 *   real risk here because every Greenhouse/Ashby candidate gets verified
 *   against the live board (resolve-freshness.ts) before it can ever become
 *   a suggestion, so an old-but-still-open posting is exactly as safe to
 *   surface as a new one.
 *
 * The industry-context queries (AI/cloud/infra, energy/climate,
 * defense/govtech) stay deliberately separate narrow queries rather than
 * one merged query — a 2026-07-22 diagnostic found merging them makes
 * Perplexity default to whichever term is most emphasized (in practice,
 * "AI"), silently dropping the others. Don't re-merge them.
 *
 * `broaden` (the widen pass) draws the NEXT disjoint slice of the role pool
 * (via the salt offset) instead of appending an instruction suffix to the
 * same queries — a suffix asking Perplexity to "focus on adjacent
 * industries" measured as a no-op (19/20 identical results to pass 1)
 * because /search is ranked retrieval, not an instruction-follower; a
 * genuinely different query is the only way to get genuinely different
 * results.
 */
export function buildDiscoveryQueries(params: {
  profile: CandidateProfile;
  lastRunDate?: Date | null;
  broaden?: boolean;
  /** Pins the rotation step; defaults to a 15-minute time bucket. */
  rotationSeed?: number;
  /**
   * Supplies the title phrases to query for. Defaults to the operations scope,
   * which is what this module used to hardcode.
   */
  roleScope?: RoleScope;
}): DiscoveryQuery[] {
  const criteria = params.profile.searchCriteria;
  const roleFamilies = criteria?.roleFamilies?.length
    ? criteria.roleFamilies
    : ["Business Operations Manager"];
  const locations = criteria?.locations?.length ? criteria.locations : ["Remote - US"];
  const industries = criteria?.industries?.length ? criteria.industries : [];

  const locationList = locations.join(", ");
  const industryList =
    industries.length > 0
      ? industries.join(", ")
      : "AI infrastructure, cloud infrastructure, developer tools";

  // The candidate's own stated families come first, then the scope's phrases.
  // Both are the same role family now, so this widens coverage within it rather
  // than mixing two different professions together.
  const scope = params.roleScope ?? OPS_ROLE_SCOPE;
  const pool = [...new Set([...roleFamilies, ...scope.titlePhrases])];
  // Each run consumes two consecutive slices: the fresh pass takes one and the
  // widen pass the next, so the two are disjoint within a run AND the next run
  // starts past both instead of re-drawing what this run just used.
  const step = currentRotationStep(params.rotationSeed);
  const sliceIndex = step * 2 + (params.broaden ? 1 : 0);
  const rolePhrases = rotateSlice(pool, ROLE_QUERIES_PER_RUN, sliceIndex);

  const afterDate = params.lastRunDate ? formatDateForPerplexity(params.lastRunDate) : undefined;
  // Cold start (no prior run date yet): bound the very first query with a
  // month filter rather than firing unbounded; every later run has a real
  // afterDate to work with instead.
  const coldStartRecency: DiscoveryQuery["recencyFilter"] = afterDate ? undefined : "month";

  const roleQueries: DiscoveryQuery[] = rolePhrases.map((phrase, i) => {
    // Split the rotated phrases across the two recency tracks so every run
    // gets both an incremental sweep and a no-recency backfill sweep.
    const isFreshTrack = i % 2 === 0;
    return {
      query: `${phrase} job posting in ${locationList} or remote US`,
      domainFilter: ATS_DOMAIN_FILTER,
      ...(isFreshTrack ? { afterDate, recencyFilter: coldStartRecency } : {}),
    };
  });

  const industryQueries: DiscoveryQuery[] = [
    {
      query: `business operations or strategy & operations job posting at a company in ${industryList}, cloud infrastructure, or AI/ML (infrastructure, applied AI, AI safety, or AI products), in ${locationList} or remote US`,
      domainFilter: ATS_DOMAIN_FILTER,
    },
    {
      query: `business operations or strategy & operations job posting at an energy or climate tech company, in ${locationList} or remote US`,
      domainFilter: ATS_DOMAIN_FILTER,
    },
    {
      query: `business operations or strategy & operations job posting at a defense contractor or govtech/public-sector technology company, in ${locationList} or remote US`,
      domainFilter: ATS_DOMAIN_FILTER,
    },
  ];

  return [...roleQueries, ...industryQueries];
}

async function runPerplexitySearch(q: DiscoveryQuery): Promise<PerplexitySearchResult[]> {
  const res = await fetch(PERPLEXITY_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: q.query,
      max_results: MAX_RESULTS_PER_QUERY,
      max_tokens_per_page: MAX_TOKENS_PER_PAGE,
      ...(q.afterDate ? { search_after_date_filter: q.afterDate } : {}),
      ...(q.recencyFilter ? { search_recency_filter: q.recencyFilter } : {}),
      ...(q.domainFilter ? { search_domain_filter: q.domainFilter } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Perplexity Search API error (${res.status}): ${body}`);
  }

  const body = await res.json();
  return Array.isArray(body.results) ? body.results : [];
}

function formatResults(results: PerplexitySearchResult[]): string {
  return results
    .map(
      (r) =>
        `- Title: ${r.title}\n  URL: ${r.url}\n  Snippet: ${r.snippet}${r.date ? `\n  Posted: ${r.date}` : ""}`
    )
    .join("\n");
}

/**
 * Broad-discovery step: fires the query set in parallel against Perplexity's
 * Search API and returns the combined raw material (formatted results text +
 * result URLs) for a downstream Claude call to structure, dedupe, and score.
 * Deliberately returns raw/untrusted material rather than JobCandidate
 * objects — nothing here is validated against the seniority ceiling,
 * URL-legitimacy rules, or live-board freshness; that all still happens
 * downstream exactly as before.
 */
export async function discoverCandidatePostings(params: {
  profile: CandidateProfile;
  lastRunDate?: Date | null;
  broaden?: boolean;
  /** Supplies the title phrases to query for; see buildDiscoveryQueries. */
  roleScope?: RoleScope;
}): Promise<DiscoveryResult> {
  if (!process.env.PERPLEXITY_API_KEY) {
    return {
      combinedText: "",
      citations: [],
      warning: "PERPLEXITY_API_KEY is not set — discovery step skipped.",
    };
  }

  const queries = buildDiscoveryQueries(params);

  const results = await Promise.allSettled(queries.map((q) => runPerplexitySearch(q)));

  const combinedText = results
    .map((r, i) =>
      r.status === "fulfilled" && r.value.length > 0
        ? `--- Discovery pass ${i + 1} ---\n${formatResults(r.value)}`
        : null
    )
    .filter((s): s is string => s !== null)
    .join("\n\n");

  const citations = [
    ...new Set(
      results.flatMap((r) => (r.status === "fulfilled" ? r.value.map((x) => x.url) : []))
    ),
  ];

  const failures = results.filter((r) => r.status === "rejected");
  const warning =
    failures.length > 0
      ? `${failures.length} of ${queries.length} Perplexity discovery queries failed: ${
          (failures[0] as PromiseRejectedResult).reason instanceof Error
            ? (failures[0] as PromiseRejectedResult).reason.message
            : String((failures[0] as PromiseRejectedResult).reason)
        }`
      : undefined;

  await logLlmUsage({
    callSite: "perplexity_discovery",
    provider: "perplexity",
    model: "sonar",
    requestCount: queries.length,
    estimatedCostUsd: estimatePerplexityCostUsd(queries.length),
  });

  return { combinedText, citations, warning };
}
