import type { CandidateProfile } from "@/lib/db/schema";
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
 * rotating which ones run each day (see rotateSlice below) means a rerun
 * doesn't just re-fetch yesterday's near-identical result set.
 */
const ROLE_SYNONYM_POOL = [
  "Operations Manager",
  "Senior Operations Manager",
  "Strategy and Operations Manager",
  "Senior Strategy and Operations Manager",
  "GTM Strategy and Operations Manager",
  "Revenue Operations Manager",
  "Sales Strategy and Operations Manager",
  "Business Operations Lead",
  "Business Operations Analyst",
  "Technical Operations Manager",
  "Operations Strategy Manager",
  "Growth Operations Manager",
  "Partner Operations Manager",
  "Marketplace Strategy and Operations Manager",
];

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
 * Deterministic day-based rotation, no persisted cursor required: which
 * slice of the pool a run draws from shifts by `salt` positions every day,
 * so back-to-back runs on the same day (fresh pass + widen pass) draw
 * disjoint slices, and tomorrow's run draws a different slice than today's,
 * without needing a DB column to remember where the last run left off.
 */
function rotateSlice<T>(pool: readonly T[], count: number, salt: number): T[] {
  if (pool.length === 0) return [];
  const epochDay = Math.floor(Date.now() / 86_400_000);
  const offset = (epochDay + salt) % pool.length;
  const n = Math.min(count, pool.length);
  return Array.from({ length: n }, (_, i) => pool[(offset + i) % pool.length]);
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

  const pool = [...new Set([...roleFamilies, ...ROLE_SYNONYM_POOL])];
  // Widen pass draws the slice immediately after the fresh pass's slice
  // (salt offset by ROLE_QUERIES_PER_RUN) so it's disjoint, not a repeat.
  const salt = params.broaden ? ROLE_QUERIES_PER_RUN : 0;
  const rolePhrases = rotateSlice(pool, ROLE_QUERIES_PER_RUN, salt);

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
