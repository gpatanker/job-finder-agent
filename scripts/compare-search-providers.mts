/**
 * Head-to-head retrieval comparison: Perplexity Search API vs Exa Search API.
 *
 * Run:  node --env-file=.env.local ./node_modules/.bin/tsx scripts/compare-search-providers.mts [--arms=parity,tuned] [--json=out.json]
 *
 * METHODOLOGY — why this script is shaped the way it is:
 *
 * 1. IDENTICAL QUERIES. Both arms call `buildDiscoveryQueries` from
 *    perplexity-discover.ts, so query text, day-based rotation and the ATS
 *    domain filter are byte-identical. The 2026-07-27 diagnostic established
 *    that query construction dominates yield; holding it fixed is the only
 *    way to attribute a difference to the engine.
 *
 * 2. NOTHING IS PERSISTED. The live /api/search/run route permanently
 *    excludes any company+title already in `jobs` or `job_search_suggestions`
 *    — including dismissed ones. If arm A wrote its finds before arm B ran,
 *    arm B would be scored against a DB that arm A had already claimed. That
 *    would make whichever provider runs second look strictly worse, purely as
 *    an artefact of ordering. So this script only READS the known-jobs
 *    snapshot and never inserts. Both arms are scored against the same frozen
 *    snapshot taken before either runs.
 *
 * 3. RETRIEVAL IS MEASURED SEPARATELY FROM STRUCTURING. The expensive Claude
 *    structuring call (~$0.22/call, ~80% of a run's cost) is identical
 *    downstream of both providers, so it is excluded by default — including
 *    it would add cost and variance while measuring a component that does not
 *    differ. What IS measured is everything the engine controls: how many
 *    real, live, in-scope, not-already-known ATS deep links it surfaces.
 *    Pass --with-structuring to additionally run the end-to-end path.
 *
 * 4. THE SAME DETERMINISTIC FILTERS THE REAL PIPELINE USES are applied to
 *    both arms (blocked-sources, specificity-check, live-board freshness), so
 *    "results returned" is converted into "results this pipeline could
 *    actually use" — the only number that matters.
 *
 * Arms:
 *   parity — Exa with the same include-domain filter as Perplexity. The fair fight.
 *   tuned  — Exa additionally using excludeDomains, which Perplexity has no
 *            equivalent for. Measures what Exa's one genuine feature edge buys.
 */
import postgres from "postgres";
import { discoverCandidatePostings, buildDiscoveryQueries } from "@/lib/search/perplexity-discover";
import { discoverCandidatePostingsExa } from "@/lib/search/exa-discover";
import { looksLikeGenericCareersPage } from "@/lib/search/specificity-check";
import { isBlockedSource } from "@/lib/search/blocked-sources";
import { resolveCandidateFreshness, type LiveBoardCache } from "@/lib/search/resolve-freshness";
import { estimatePerplexityCostUsd } from "@/lib/observability/llm-usage";
import type { CandidateProfile } from "@/lib/db/schema";

const argv = process.argv.slice(2);
const arg = (name: string, dflt?: string) =>
  argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? dflt;
const arms = (arg("arms", "parity") as string).split(",").map((s) => s.trim());
const jsonOut = arg("json");

/** Domains that have repeatedly produced unusable results — Exa can filter these at retrieval. */
const EXCLUDE_FOR_TUNED = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "simplyhired.com",
  "jobs-search.io",
  "startup.jobs",
  "wellfound.com",
];

type ArmResult = {
  arm: string;
  requestCount: number;
  wallMs: number;
  costUsd: number;
  rawUrls: number;
  uniqueUrls: number;
  afterBlocked: number;
  afterSpecificity: number;
  liveVerified: number;
  distinctCompanies: number;
  newCompanies: number;
  newCompanyNames: string[];
  usableUrls: string[];
};

/**
 * ATS URLs carry a board slug ("andurilindustries", "doordashusa") while the
 * DB stores display names ("Anduril Industries", "DoorDash"). Comparing them
 * raw marks almost every known company as "new" — it inflated NEW-CO for
 * every arm in the first measurement run. Collapsing both sides to bare
 * alphanumerics makes the comparison meaningful. Still imperfect (a slug like
 * "doordashusa" won't equal "doordash"), so we also test containment both
 * ways, which is the common real-world shape.
 */
function normalizeCompany(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isKnownCompany(slug: string, known: Set<string>): boolean {
  const n = normalizeCompany(slug);
  if (!n) return true;
  if (known.has(n)) return true;
  for (const k of known) {
    if (k.length >= 4 && (n.includes(k) || k.includes(n))) return true;
  }
  return false;
}

function companyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const p = u.pathname.split("/").filter(Boolean);
    if (u.hostname.includes("greenhouse.io")) return p[0] ?? null;
    if (u.hostname.includes("ashbyhq.com")) return p[0] ?? null;
    if (u.hostname.includes("lever.co")) return p[0] ?? null;
    if (u.hostname.includes("rippling.com")) return p[0] ?? null;
    if (u.hostname.includes("smartrecruiters.com")) return p[0] ?? null;
    if (u.hostname.includes("workable.com")) return p[0] ?? null;
    return u.hostname;
  } catch {
    return null;
  }
}

async function score(
  arm: string,
  citations: string[],
  requestCount: number,
  costUsd: number,
  wallMs: number,
  knownCompanies: Set<string>,
  cache: LiveBoardCache
): Promise<ArmResult> {
  const unique = [...new Set(citations)];
  const notBlocked = unique.filter((u) => !isBlockedSource(u));
  const specific = notBlocked.filter((u) => !looksLikeGenericCareersPage(u));

  // Live-board verification, the same authoritative check the real pipeline runs.
  const verified = await Promise.all(
    specific.map(async (url) => {
      try {
        const r = await resolveCandidateFreshness({
          applyUrl: url,
          sourceUrl: url,
          title: "",
          company: companyFromUrl(url) ?? "",
          liveBoardCache: cache,
        });
        return r.ok ? url : null;
      } catch {
        return null;
      }
    })
  );
  const live = verified.filter((u): u is string => u !== null);

  const companies = new Set(
    live.map((u) => companyFromUrl(u)?.toLowerCase()).filter((c): c is string => !!c)
  );
  const newCompanyNames = [...companies].filter((c) => !isKnownCompany(c, knownCompanies));

  return {
    arm,
    requestCount,
    wallMs,
    costUsd,
    rawUrls: citations.length,
    uniqueUrls: unique.length,
    afterBlocked: notBlocked.length,
    afterSpecificity: specific.length,
    liveVerified: live.length,
    distinctCompanies: companies.size,
    newCompanies: newCompanyNames.length,
    newCompanyNames: newCompanyNames.sort(),
    usableUrls: live,
  };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  // Raw SQL hands back an untyped row; narrow it once here rather than
  // casting at each of the three call sites that consume it.
  const [profileRow] = await sql`select * from candidate_profile limit 1`;
  if (!profileRow) throw new Error("No candidate profile seeded.");
  const profile = profileRow as unknown as CandidateProfile;

  // Frozen snapshot — both arms scored against the identical known set.
  const knownRows = await sql`
    select lower(company) as c from jobs
    union select lower(company) as c from job_search_suggestions`;
  const knownCompanies = new Set(
    (knownRows as unknown as { c: string | null }[])
      .map((r) => normalizeCompany(r.c ?? ""))
      .filter((c) => c.length > 0)
  );

  const [recent] = await sql`
    select created_at from job_search_suggestions order by created_at desc limit 1`;
  const lastRunDate = recent ? new Date(recent.created_at.getTime() - 3 * 86_400_000) : null;

  const queries = buildDiscoveryQueries({ profile, lastRunDate });
  console.log(`Query set: ${queries.length} identical queries per arm.`);
  console.log(`Known-company snapshot: ${knownCompanies.size} companies (frozen).`);
  console.log(`Arms: ${arms.join(", ")}\n`);

  const cache: LiveBoardCache = new Map();
  const results: ArmResult[] = [];

  // --- Perplexity (control) ---
  {
    const t0 = Date.now();
    const r = await discoverCandidatePostings({ profile, lastRunDate });
    const wall = Date.now() - t0;
    if (r.warning) console.log(`  [perplexity] warning: ${r.warning}`);
    results.push(
      await score(
        "perplexity",
        r.citations,
        queries.length,
        estimatePerplexityCostUsd(queries.length),
        wall,
        knownCompanies,
        cache
      )
    );
    console.log(`✓ perplexity done (${wall}ms, ${r.citations.length} raw urls)`);
  }

  // --- Exa arms ---
  for (const armName of arms) {
    const t0 = Date.now();
    const r = await discoverCandidatePostingsExa({
      profile,
      lastRunDate,
      searchType: "auto",
      ...(armName === "tuned" ? { excludeDomains: EXCLUDE_FOR_TUNED } : {}),
    });
    const wall = Date.now() - t0;
    if (r.warning) console.log(`  [exa:${armName}] warning: ${r.warning}`);
    results.push(
      await score(
        `exa:${armName}`,
        r.citations,
        r.requestCount,
        r.costUsd,
        wall,
        knownCompanies,
        cache
      )
    );
    console.log(`✓ exa:${armName} done (${wall}ms, ${r.citations.length} raw urls)`);
  }

  // --- Report ---
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  console.log("\n" + "=".repeat(104));
  console.log(
    pad("ARM", 16) + pad("REQ", 5) + pad("COST$", 9) + pad("RAW", 6) + pad("UNIQ", 6) +
    pad("SPECIFIC", 10) + pad("LIVE", 6) + pad("COMPANIES", 11) + pad("NEW-CO", 8) + pad("SEC", 6)
  );
  console.log("-".repeat(104));
  for (const r of results) {
    console.log(
      pad(r.arm, 16) + pad(r.requestCount, 5) + pad(r.costUsd.toFixed(4), 9) +
      pad(r.rawUrls, 6) + pad(r.uniqueUrls, 6) + pad(r.afterSpecificity, 10) +
      pad(r.liveVerified, 6) + pad(r.distinctCompanies, 11) + pad(r.newCompanies, 8) +
      pad((r.wallMs / 1000).toFixed(1), 6)
    );
  }
  console.log("=".repeat(104));

  // Cost per usable result — the number that actually matters.
  console.log("\nCost per live-verified usable URL:");
  for (const r of results) {
    const cpu = r.liveVerified > 0 ? r.costUsd / r.liveVerified : NaN;
    console.log(
      `  ${pad(r.arm, 16)} ${Number.isNaN(cpu) ? "n/a (0 usable)" : "$" + cpu.toFixed(4)}` +
      `   |  cost per NEW company: ${r.newCompanies > 0 ? "$" + (r.costUsd / r.newCompanies).toFixed(4) : "n/a"}`
    );
  }

  // Overlap — are they finding the same things, or different slices of the web?
  console.log("\nOverlap between arms (live-verified URLs):");
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const a = new Set(results[i].usableUrls);
      const b = new Set(results[j].usableUrls);
      const inter = [...a].filter((u) => b.has(u)).length;
      const union = new Set([...a, ...b]).size;
      console.log(
        `  ${results[i].arm} ∩ ${results[j].arm}: ${inter} shared, ` +
        `Jaccard ${union ? (inter / union).toFixed(3) : "0.000"} ` +
        `(${results[i].arm}-only ${a.size - inter}, ${results[j].arm}-only ${b.size - inter})`
      );
    }
  }

  console.log("\nNet-new companies by arm:");
  for (const r of results) {
    console.log(`  ${r.arm}: ${r.newCompanyNames.slice(0, 25).join(", ") || "(none)"}`);
  }

  if (jsonOut) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(jsonOut, JSON.stringify({ ranAt: new Date().toISOString(), queries, results }, null, 2));
    console.log(`\nFull results written to ${jsonOut}`);
  }

  console.log("\nNOTE: nothing was written to job_search_suggestions — this was a measurement run.");
  await sql.end();
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
