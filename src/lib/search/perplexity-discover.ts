import type { CandidateProfile } from "@/lib/db/schema";
import { estimatePerplexityCostUsd, logLlmUsage } from "@/lib/observability/llm-usage";

const PERPLEXITY_SEARCH_URL = "https://api.perplexity.ai/search";
// Raw search results, not chat-completion tokens — $5/1,000 requests flat,
// no per-token billing — so it's free to ask for the maximum per call.
const MAX_RESULTS_PER_QUERY = 20;
const MAX_TOKENS_PER_PAGE = 512;

export type DiscoveryResult = {
  combinedText: string;
  citations: string[];
  warning?: string;
};

type DiscoveryQuery = {
  query: string;
  /** Restricts results to these domains — used for the direct-ATS-postings query. */
  domainFilter?: string[];
};

type PerplexitySearchResult = {
  title: string;
  url: string;
  snippet: string;
  date: string | null;
  last_updated: string | null;
};

/**
 * Builds several distinct, narrowly-scoped queries instead of one broad one.
 * The Search API returns raw ranked results for a query, not an open-ended
 * multi-round search like Claude's native web_search tool, so query variety
 * has to come from firing several requests in parallel rather than from one
 * model deciding to branch out mid-conversation. Mirrors the same branching
 * strategy (role synonyms, adjacent industries, direct ATS postings) that
 * used to live entirely in the job-search-agent system prompt.
 *
 * Industry coverage is deliberately split into 3 separate, narrow queries
 * (AI/cloud/infra, energy/climate, defense/govtech) rather than one query
 * listing every sector — a diagnostic run confirmed that cramming 10+
 * sectors into one query just makes Perplexity default to whichever term is
 * most emphasized (in practice, "AI"), silently ignoring the rest.
 */
export function buildDiscoveryQueries(params: {
  profile: CandidateProfile;
  overrepresentedCompanies: string[];
  broaden?: boolean;
}): DiscoveryQuery[] {
  const criteria = params.profile.searchCriteria;
  const roleFamilies = criteria?.roleFamilies?.length
    ? criteria.roleFamilies
    : ["Business Operations Manager"];
  const locations = criteria?.locations?.length ? criteria.locations : ["Remote - US"];
  const industries = criteria?.industries?.length ? criteria.industries : [];

  const roleList = roleFamilies.join(", ");
  const locationList = locations.join(", ");
  const industryList =
    industries.length > 0
      ? industries.join(", ")
      : "AI infrastructure, cloud infrastructure, developer tools";

  const deprioritize =
    params.overrepresentedCompanies.length > 0
      ? ` Avoid these companies already heavily represented in past results: ${params.overrepresentedCompanies.join(", ")}.`
      : "";

  const broadenNote = params.broaden
    ? " Focus on adjacent industries and less-obvious role synonyms rather than the most famous/obvious companies."
    : "";

  return [
    {
      query: `currently open job postings for ${roleList} in ${locationList} or remote US, posted this month${deprioritize}${broadenNote}`,
    },
    {
      query: `currently open job postings for "Operations Manager" OR "Strategy & Operations Manager" OR "Revenue Operations Manager" OR "Technical Operations Manager" OR "Business Operations Analyst" in ${locationList} or remote US, posted this month${deprioritize}${broadenNote}`,
    },
    {
      query: `currently open business operations or strategy & operations job postings at companies in ${industryList}, cloud infrastructure, developer tools, data infrastructure, cybersecurity, robotics, hardware, fintech infrastructure, or any AI/ML company (infrastructure, applied AI, AI safety, or AI products), in ${locationList} or remote US${deprioritize}${broadenNote}`,
    },
    {
      query: `${roleList} job postings in ${locationList} or remote US${deprioritize}`,
      domainFilter: ["job-boards.greenhouse.io", "jobs.ashbyhq.com"],
    },
    {
      query: `currently open business operations or strategy & operations job postings at energy or climate tech companies, in ${locationList} or remote US${deprioritize}${broadenNote}`,
    },
    {
      query: `currently open business operations or strategy & operations job postings at defense contractors or govtech/public-sector technology companies, in ${locationList} or remote US${deprioritize}${broadenNote}`,
    },
  ];
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
      search_recency_filter: "month",
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
  overrepresentedCompanies: string[];
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
