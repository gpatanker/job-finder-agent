import type { CandidateProfile } from "@/lib/db/schema";
import { logLlmUsage } from "@/lib/observability/llm-usage";
import {
  ATS_DOMAIN_FILTER,
  buildDiscoveryQueries,
  type DiscoveryResult,
} from "./perplexity-discover";

/**
 * Exa discovery channel — a drop-in alternative to perplexity-discover.ts's
 * `discoverCandidatePostings`, deliberately built to be A/B-comparable rather
 * than "better by design".
 *
 * The whole point of this module is measurement, so it reuses
 * `buildDiscoveryQueries` from the Perplexity module verbatim instead of
 * writing Exa-flavoured queries. Identical query text, identical rotation,
 * identical domain filter — the only variable is the retrieval engine. If
 * this module built its own queries, any difference in yield would be
 * unattributable (the 2026-07-27 diagnostic already established that query
 * construction, not vendor, drove yield — so query parity is the only way to
 * isolate the vendor).
 *
 * Pricing note (verified against exa.ai/docs/reference/pricing, 2026-09-10):
 * $7/1k requests covers up to 10 results; additional results bill at
 * $1/1k results. Perplexity by contrast is a flat $5/1k regardless of
 * result count, which is why `MAX_RESULTS_PER_QUERY` is free there and is
 * NOT free here. We don't estimate that math ourselves — Exa returns a
 * `costDollars` object per response, so actual spend is recorded rather
 * than modelled.
 */
const EXA_SEARCH_URL = "https://api.exa.ai/search";

/** Matches MAX_RESULTS_PER_QUERY in perplexity-discover.ts so recall is equal. */
const NUM_RESULTS_PER_QUERY = 20;

/**
 * Exa's search modes. "auto" (the API default) lets Exa pick between its
 * neural index and keyword search per query; "keyword" and "fast" are the
 * cheaper/more literal ends. Kept configurable because "does neural search
 * actually find postings keyword search misses" is one of the questions this
 * comparison exists to answer.
 */
export type ExaSearchType = "auto" | "fast" | "instant";

export type ExaDiscoveryOptions = {
  profile: CandidateProfile;
  lastRunDate?: Date | null;
  broaden?: boolean;
  /** Defaults to "auto". */
  searchType?: ExaSearchType;
  /**
   * Exa-only capability with no Perplexity equivalent: a retrieval-time
   * blocklist. Off by default so the headline A/B stays apples-to-apples —
   * turn it on for the "Exa tuned" arm to measure what the feature is worth.
   */
  excludeDomains?: string[];
};

type ExaResult = {
  title: string | null;
  url: string;
  publishedDate?: string | null;
  author?: string | null;
  text?: string | null;
  summary?: string | null;
};

type ExaResponse = {
  results?: ExaResult[];
  costDollars?: { total?: number };
};

/**
 * Exa enforces a default limit of 10 requests/second and returns HTTP 429
 * (`RATE_LIMIT_EXCEEDED`) above it. A naive `Promise.all` over the 11-query
 * set trips this every single run and silently loses a query — measured on
 * 2026-09-10, where both Exa arms completed only 10 of 11 queries while
 * Perplexity (no comparable limit at this volume) completed all 11.
 * Capping in-flight requests keeps the arms comparable, and costs ~1s.
 */
const MAX_CONCURRENT_REQUESTS = 5;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * `buildDiscoveryQueries` emits Perplexity's MM/DD/YYYY date format; Exa
 * wants ISO 8601. Converting here (rather than threading a raw Date through
 * the shared builder) keeps the shared builder untouched, which is what
 * guarantees both providers get byte-identical query text.
 */
function toIsoDate(mmddyyyy: string): string | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mmddyyyy);
  if (!m) return undefined;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
}

/** Coarse recency buckets are a Perplexity-only cold-start concept; map to a real date. */
function recencyToIsoDate(bucket: "day" | "week" | "month" | "year"): string {
  const days = { day: 1, week: 7, month: 30, year: 365 }[bucket];
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function runExaSearch(
  q: ReturnType<typeof buildDiscoveryQueries>[number],
  opts: { searchType: ExaSearchType; excludeDomains?: string[] }
): Promise<{ results: ExaResult[]; costUsd: number }> {
  const startPublishedDate = q.afterDate
    ? toIsoDate(q.afterDate)
    : q.recencyFilter
      ? recencyToIsoDate(q.recencyFilter)
      : undefined;

  const res = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: {
      "x-api-key": process.env.EXA_API_KEY ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: q.query,
      numResults: NUM_RESULTS_PER_QUERY,
      type: opts.searchType,
      ...(q.domainFilter ? { includeDomains: q.domainFilter } : {}),
      ...(opts.excludeDomains?.length ? { excludeDomains: opts.excludeDomains } : {}),
      ...(startPublishedDate ? { startPublishedDate } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Exa Search API error (${res.status}): ${body}`);
  }

  const body: ExaResponse = await res.json();
  return {
    results: Array.isArray(body.results) ? body.results : [],
    // Exa reports actual spend per request; fall back to the documented
    // $7/1k + $1/1k-beyond-10-results rate card only if it's ever absent.
    costUsd:
      typeof body.costDollars?.total === "number"
        ? body.costDollars.total
        : 0.007 + Math.max(0, NUM_RESULTS_PER_QUERY - 10) * 0.001,
  };
}

/**
 * Formats results into the same shape perplexity-discover.ts hands the
 * downstream Claude structuring call, so the structuring prompt cannot tell
 * which engine produced the material. Exa has no "snippet" field, so its
 * `text`/`summary` (when present) stands in; when absent the line is omitted
 * rather than faked, since a missing snippet is itself a real difference
 * between the two engines worth surfacing in the comparison.
 */
function formatResults(results: ExaResult[]): string {
  return results
    .map((r) => {
      const snippet = (r.summary ?? r.text ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      return [
        `- Title: ${r.title ?? "(untitled)"}`,
        `  URL: ${r.url}`,
        snippet ? `  Snippet: ${snippet}` : null,
        r.publishedDate ? `  Posted: ${r.publishedDate}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

/**
 * Drop-in counterpart to `discoverCandidatePostings`. Same signature, same
 * return type, same downstream contract: returns raw/untrusted material for
 * the Claude structuring call, with no seniority, URL-legitimacy or
 * live-board validation applied here.
 */
export async function discoverCandidatePostingsExa(
  params: ExaDiscoveryOptions
): Promise<DiscoveryResult & { costUsd: number; requestCount: number }> {
  if (!process.env.EXA_API_KEY) {
    return {
      combinedText: "",
      citations: [],
      warning: "EXA_API_KEY is not set — Exa discovery step skipped.",
      costUsd: 0,
      requestCount: 0,
    };
  }

  const searchType = params.searchType ?? "auto";
  const queries = buildDiscoveryQueries({
    profile: params.profile,
    lastRunDate: params.lastRunDate,
    broaden: params.broaden,
  });

  const settled = await mapWithConcurrency(queries, MAX_CONCURRENT_REQUESTS, (q) =>
    runExaSearch(q, { searchType, excludeDomains: params.excludeDomains })
  );

  const combinedText = settled
    .map((r, i) =>
      r.status === "fulfilled" && r.value.results.length > 0
        ? `--- Discovery pass ${i + 1} ---\n${formatResults(r.value.results)}`
        : null
    )
    .filter((s): s is string => s !== null)
    .join("\n\n");

  const citations = [
    ...new Set(
      settled.flatMap((r) => (r.status === "fulfilled" ? r.value.results.map((x) => x.url) : []))
    ),
  ];

  const costUsd = settled.reduce(
    (sum, r) => sum + (r.status === "fulfilled" ? r.value.costUsd : 0),
    0
  );

  const failures = settled.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  const warning =
    failures.length > 0
      ? `${failures.length} of ${queries.length} Exa discovery queries failed: ${
          failures[0].reason instanceof Error
            ? failures[0].reason.message
            : String(failures[0].reason)
        }`
      : undefined;

  await logLlmUsage({
    callSite: "exa_discovery",
    provider: "exa",
    model: `exa-search-${searchType}`,
    requestCount: queries.length,
    estimatedCostUsd: costUsd,
  });

  return { combinedText, citations, warning, costUsd, requestCount: queries.length };
}

export { ATS_DOMAIN_FILTER };
