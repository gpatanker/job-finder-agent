import { isComparableTitle } from "./freshness-check";
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
 *
 * Title matching here is deliberately NOT the fuzzy textMentionsTitle used
 * elsewhere. That matcher answers "is this page still about the posting we
 * already believe in", where the input title is known-good; pointing it at
 * an arbitrary live board's entire job list is a different question, and it
 * failed badly at it. The 2026-07-27 quality review found three separate
 * false-positive mechanisms in that first version, all confirmed by
 * replaying the real titles it surfaced:
 *
 *   1. The bare "Operations Manager" synonym matched as an exact substring
 *      of ANY "<something> Operations Manager", so the qualifier was
 *      unconstrained — Recruiting (Ripple, PermitFlow, Harvey), Warehouse
 *      (Coram AI), HR & People (OpenFX), Billing, Treasury, Hardware,
 *      Content and Lifecycle Operations Manager all sailed through.
 *   2. The 70%-word-overlap fallback counted the stopword "and", so
 *      "Recruiting Operations and Programs Manager" hit 3/4 words of
 *      "Strategy and Operations Manager" (and, operations, manager) — that
 *      one would have slipped past even if the bare synonym were dropped.
 *   3. The reverse-direction call put the live board's own title in
 *      textMentionsTitle's `title` parameter, where a title in a non-Latin
 *      script normalized to the empty string and hit the "nothing to look
 *      for, so trivially true" early return — making it a wildcard that
 *      matched every target phrase at once (Databricks'
 *      "ソリューションアーキテクト (プリセールス)", a pre-sales solution
 *      architect role in Japanese). Root-caused in freshness-check.ts.
 *
 * The replacement below is a structural test instead of a fuzzy one: a title
 * has to name an operations/strategy function AND name a domain that is
 * actually this candidate's (business, revenue, GTM, sales, growth,
 * partner, product, technical, infrastructure), AND not name an adjacent
 * specialization that isn't his (recruiting, HR/people, warehouse/supply
 * chain, IT/support, clinical, billing/treasury, content/community). The
 * positive requirement is what generalizes: an unknown specialization we
 * never thought to exclude ("Kitchen Operations Manager") fails for lack of
 * a qualifying domain rather than needing to be enumerated.
 */

function boardKey(board: AtsBoard): string {
  return board.platform === "greenhouse" ? `greenhouse:${board.boardToken}` : `ashby:${board.orgSlug}`;
}

/** Space-padded, punctuation-stripped form so every lookup below can be a word-boundary-safe substring test (` intern ` must not match `internal`). */
function normalizeForMatch(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

function hasAny(normalized: string, phrases: readonly string[]): boolean {
  return phrases.some((p) => normalized.includes(` ${p} `));
}

/** The operations/strategy function itself — a title with none of these isn't an ops role at all (catches "Senior Business Systems Manager", "Business Development Senior Manager", "Business Process Controls"). */
const OPS_HEAD = ["operations", "operation", "ops", "revops", "bizops", "biz ops", "rev ops"] as const;
const STRATEGY_HEAD = ["strategy", "strategic"] as const;

/** Domains that ARE this candidate's function (BizOps / Strategy & Ops / RevOps / GTM Ops). */
const CORE_DOMAINS = [
  "business",
  "biz",
  "bizops",
  "revenue",
  "revops",
  "rev",
  "gtm",
  "go to market",
  "commercial",
  "corporate",
] as const;

/**
 * Domains adjacent enough to be worth surfacing but a weaker fit than the
 * core set — matched, then scored lower rather than silently dropped.
 * "compute"/"infrastructure" are in here specifically because
 * "Infrastructure Operations" and "AI Infrastructure Operations" are among
 * the candidate's own stated role families.
 */
const ADJACENT_DOMAINS = [
  "sales",
  "growth",
  "partner",
  "partners",
  "partnership",
  "partnerships",
  "channel",
  "technical",
  "product",
  "pricing",
  "customer success",
  "deal desk",
  "compute",
  "infrastructure",
  "infra",
  "data center",
  "datacenter",
] as const;

/**
 * Specializations that share the word "operations" but are a different
 * profession — disqualifying even when a core domain word is also present
 * ("People Strategy & Operations" and "Talent Business Partner" both name
 * one of the core domains and are both still the wrong function). Every
 * entry here was either surfaced as real garbage on 2026-07-27 or is the
 * obvious sibling of one that was.
 */
const DISQUALIFYING_DOMAINS = [
  // HR / recruiting
  "recruiting", "recruitment", "recruiter", "talent", "hr", "human resources",
  "people", "personnel", "payroll", "benefits", "compensation", "immigration",
  "onboarding specialist",
  // Facilities / workplace / admin
  "workplace", "facilities", "facility", "real estate", "office manager", "executive assistant",
  // Healthcare / clinical
  "clinical", "patient", "medical", "nursing", "nurse", "pharmacy", "veterinary",
  // Money-movement back office
  "billing", "treasury", "collections", "accounts payable", "accounts receivable",
  "payroll operations", "loan", "lending", "claims", "underwriting", "escrow",
  // IT / infosec / network operations centers
  "it operations", "it ops", "information technology", "helpdesk", "help desk",
  "service desk", "desktop", "network operations", "security operations", "soc",
  // Content / community / trust & safety
  "content", "moderation", "trust and safety", "editorial", "social media",
  "community", "creative", "studio", "brand",
  // Physical/industrial and consumer-venue operations
  "restaurant", "kitchen", "culinary", "hospitality", "hotel", "retail store",
  "housekeeping", "janitorial", "farm", "agriculture", "mining", "construction",
  // Other functions that borrow "operations"
  "data operations", "labeling", "annotation", "lifecycle", "hardware",
  "research operations", "legal operations", "flight", "aviation", "maritime",
  // Finance and marketing — hard exclusions, not softer ADJACENT_DOMAINS
  // qualifiers, even when paired with "business"/"operations"/"strategy"
  // (confirmed 2026-07-28: "Strategic Finance - Business Operations Lead"
  // and "Manager, Strategic Finance & Business Operations" are explicitly
  // out of scope despite both naming a core domain).
  "finance", "financial", "accounting", "fp a",
  "marketing",
  // Level, not domain, but never worth surfacing
  "intern", "internship", "apprentice",
] as const;

/**
 * Softer exclusions: a different specialization on its own, but the
 * candidate's brief explicitly allows them when the role is clearly framed
 * as a business/strategy role rather than a functional one — so these are
 * only disqualifying when neither "business" nor "strategy" appears
 * (rejects "Supply Chain Operations Program Manager", keeps "Strategy and
 * Operations Associate, Supply Quality").
 */
const CONDITIONAL_DOMAINS = [
  "warehouse", "logistics", "supply chain", "supply", "fulfillment", "fulfilment",
  "inventory", "procurement", "distribution", "transportation", "fleet", "dispatch",
  "courier", "driver", "trucking", "manufacturing", "plant", "maintenance",
  "support", "service operations", "call center", "contact center", "field operations",
] as const;

export type RoleFamilyTier = "core" | "strategy-ops" | "strategy" | "adjacent" | null;

/**
 * The precision gate: which tier of this candidate's function a live-board
 * title belongs to, or null if it isn't his function at all. Exported so
 * the score can reuse the same classification rather than re-deriving it
 * (and so the real-world title corpus can be asserted directly in tests).
 */
export function classifyRoleFamily(jobTitle: string): RoleFamilyTier {
  // An uncomparable title (non-Latin script, punctuation only) can't be
  // judged — reject rather than guess. This is the case that used to
  // wildcard-match everything.
  if (!isComparableTitle(jobTitle)) return null;

  const t = normalizeForMatch(jobTitle);

  if (hasAny(t, DISQUALIFYING_DOMAINS)) return null;

  const hasStrategy = hasAny(t, STRATEGY_HEAD);
  const hasBusinessOrStrategy = hasStrategy || t.includes(" business ");
  if (hasAny(t, CONDITIONAL_DOMAINS) && !hasBusinessOrStrategy) return null;

  const hasOps = hasAny(t, OPS_HEAD);
  const hasCore = hasAny(t, CORE_DOMAINS);
  const hasAdjacent = hasAny(t, ADJACENT_DOMAINS);

  if (hasOps) {
    if (hasCore) return "core";
    // "Strategy & Operations" is itself the candidate's function, so
    // "strategy" qualifies an ops title on its own — but only in that
    // combination. On its own it would let any "<domain> Strategy" title in
    // (real case: "Associate Manager, Consumer Promotions Strategy").
    if (hasStrategy) return "strategy-ops";
    if (hasAdjacent) return "adjacent";
    // Bare "Operations Manager" with no qualifying domain at all — the
    // single biggest source of 2026-07-27's garbage. Rejected on purpose.
    return null;
  }

  if (hasStrategy) {
    if (hasCore) return "strategy";
    if (hasAdjacent) return "adjacent";
  }

  return null;
}

export function titleMatchesTargetRoleFamily(jobTitle: string): boolean {
  return classifyRoleFamily(jobTitle) !== null;
}

/**
 * Only ever used to REJECT, and only when a non-US place is named and no US
 * place is — so an unlabeled or ambiguous location always passes through.
 * A false US hit only means "don't reject", which is the safe direction;
 * two-letter state codes that are also common English words ("in", "or",
 * "me", "hi", "la", "de", "ok", "id") are left out anyway, since this also
 * runs against raw job titles. Real case this fixes: "Overview Corporation
 * — Operations Manager - Guadalajara", surfaced from a company whose known
 * posting was US-remote.
 */
const US_MARKERS = [
  "united states", "usa", "u s", "us", "remote us", "us remote", "nationwide",
  "san francisco", "bay area", "silicon valley", "new york", "nyc", "brooklyn",
  "seattle", "boston", "austin", "chicago", "denver", "los angeles", "san diego",
  "san jose", "palo alto", "mountain view", "menlo park", "redwood city", "sunnyvale",
  "fremont", "san mateo", "atlanta", "dallas", "houston", "miami", "phoenix",
  "portland", "philadelphia", "washington dc", "arlington", "el segundo", "boise",
  "california", "texas", "washington", "new jersey", "massachusetts", "illinois",
  "colorado", "georgia", "florida", "virginia", "arizona", "oregon", "utah",
  "ak", "az", "ar", "ca", "co", "ct", "fl", "ga", "il", "ia", "ks", "ky",
  "md", "ma", "mi", "mn", "ms", "mo", "mt", "nv", "nh", "nj", "nm", "ny", "nc",
  "nd", "pa", "ri", "sc", "sd", "tn", "tx", "vt", "va", "wa", "wv", "wi", "wy", "dc",
] as const;

const NON_US_MARKERS = [
  "canada", "toronto", "vancouver", "montreal", "ottawa", "ontario", "quebec",
  "british columbia", "mexico", "guadalajara", "monterrey", "mexico city",
  "brazil", "brasil", "sao paulo", "argentina", "buenos aires", "chile", "santiago",
  "colombia", "bogota", "peru", "lima", "costa rica", "latin america", "latam",
  "united kingdom", "uk", "london", "england", "scotland", "edinburgh", "manchester",
  "ireland", "dublin", "france", "paris", "germany", "berlin", "munich", "hamburg",
  "netherlands", "amsterdam", "belgium", "brussels", "spain", "madrid", "barcelona",
  "portugal", "lisbon", "italy", "milan", "rome", "switzerland", "zurich", "geneva",
  "sweden", "stockholm", "norway", "oslo", "denmark", "copenhagen", "finland",
  "helsinki", "poland", "warsaw", "krakow", "czech", "prague", "romania", "bucharest",
  "hungary", "budapest", "greece", "athens", "turkey", "istanbul", "emea",
  "israel", "tel aviv", "uae", "dubai", "abu dhabi", "saudi", "riyadh", "qatar",
  "egypt", "cairo", "south africa", "cape town", "johannesburg", "nigeria", "lagos",
  "kenya", "nairobi", "africa", "india", "bangalore", "bengaluru", "mumbai",
  "new delhi", "gurgaon", "gurugram", "hyderabad", "pune", "chennai", "noida",
  "china", "beijing", "shanghai", "shenzhen", "hong kong", "taiwan", "taipei",
  "japan", "tokyo", "osaka", "korea", "seoul", "singapore", "malaysia",
  "kuala lumpur", "indonesia", "jakarta", "thailand", "bangkok", "vietnam",
  "hanoi", "ho chi minh", "philippines", "manila", "australia", "sydney",
  "melbourne", "brisbane", "new zealand", "auckland", "apac",
] as const;

/** Confidently non-US (names a non-US place and no US place). Ambiguous or unlabeled text is never rejected. */
export function isLikelyNonUsLocation(text: string | undefined | null): boolean {
  if (!text) return false;
  const t = normalizeForMatch(text);
  if (hasAny(t, US_MARKERS)) return false;
  return hasAny(t, NON_US_MARKERS);
}

const TIER_WEIGHT: Record<Exclude<RoleFamilyTier, null>, number> = {
  core: 24,
  "strategy-ops": 22,
  strategy: 16,
  adjacent: 14,
};

const SENIOR_MARKERS = ["senior", "sr", "snr", "staff", "principal"] as const;
const MANAGER_MARKERS = ["manager", "management", "lead", "leader", "principal", "staff"] as const;
const JUNIOR_MARKERS = [
  "associate", "coordinator", "assistant", "specialist", "early career",
  "entry level", "junior", "jr", "trainee",
] as const;

/**
 * Deliberately deterministic rather than a second Claude call. The channel's
 * whole point is being free, and — unlike the Perplexity path, which hands
 * Claude a posting's surrounding text, location and salary — all this
 * channel has is a title string. An LLM scoring a bare title would spend
 * real money to restate what the title already says, add a failure mode to
 * a path that currently cannot fail, and still not be comparable to the
 * Claude scores (which are grounded in material this channel doesn't have).
 * So: a tiered heuristic that actually differentiates, capped at 88 to stay
 * honestly below the Claude channel's ceiling given the thinner evidence.
 *
 * Replaces the original flat-bucket version, which scored essentially
 * everything 55 (its two bonuses required "strategy"+"operations" together,
 * or a title exactly string-equal to a role family — which never fired). A
 * screen of 58 suggestions all reading "55/100" carries no ranking
 * information at all, which is what prompted this review.
 */
export function scoreLiveBoardMatch(
  jobTitle: string,
  roleFamilies: string[],
  location?: string
): number {
  const tier = classifyRoleFamily(jobTitle);
  if (!tier) return 0;

  const t = normalizeForMatch(jobTitle);
  let score = 50;

  score += TIER_WEIGHT[tier];

  // Names one of the candidate's own stated role families verbatim (e.g.
  // "Business Operations", "GTM Operations", "RevOps") rather than merely
  // satisfying the structural test.
  if (roleFamilies.some((f) => isComparableTitle(f) && t.includes(normalizeForMatch(f)))) {
    score += 6;
  }

  if (hasAny(t, MANAGER_MARKERS)) score += 6;
  if (hasAny(t, SENIOR_MARKERS)) score += 3;
  // Right family, below the Manager level being targeted.
  if (hasAny(t, JUNIOR_MARKERS)) score -= 12;
  else if (t.includes(" analyst ")) score -= 4;

  if (location && !isLikelyNonUsLocation(location)) score += 2;

  return Math.max(40, Math.min(88, score));
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

const TIER_RATIONALE: Record<Exclude<RoleFamilyTier, null>, string> = {
  core: "the title is a direct BizOps/RevOps/GTM-Ops match to your target role families",
  "strategy-ops": "the title is a direct Strategy & Operations match to your target role families",
  strategy: "the title is a business/corporate strategy role adjacent to your target role families",
  adjacent: "the title is an adjacent operations specialization (worth a look, weaker fit than a core BizOps match)",
};

export async function discoverFromKnownCompanyBoards(params: {
  known: { company: string; applyUrl: string | null }[];
  roleFamilies: string[];
}): Promise<JobCandidate[]> {
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
      const tier = classifyRoleFamily(job.title);
      if (!tier) continue;
      // The board's own location field, plus the title itself — non-US
      // postings routinely name the city only in the title.
      if (isLikelyNonUsLocation(job.location) || isLikelyNonUsLocation(job.title)) continue;
      candidates.push({
        company,
        title: job.title,
        location: job.location,
        applyUrl: job.url,
        sourceUrl: job.url,
        matchScore: scoreLiveBoardMatch(job.title, params.roleFamilies, job.location),
        rationale: `Found via a direct poll of ${company}'s live job board (not a search result) — ${TIER_RATIONALE[tier]}.`,
      });
    }
  }
  return candidates;
}
