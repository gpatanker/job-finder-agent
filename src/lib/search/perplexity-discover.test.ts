import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateProfile } from "@/lib/db/schema";
import { ATS_DOMAIN_FILTER, buildDiscoveryQueries } from "./perplexity-discover";
import { PRODUCT_ROLE_SCOPE } from "./role-scope";

const baseProfile = {
  id: "profile-1",
  name: "Jordan Example",
  email: "jordan@example.com",
  phone: null,
  linkedin: null,
  location: "Austin, TX",
  currentCompany: "Example Corp",
  functionTags: [],
  preferredIndustries: [],
  workAuthorized: true,
  requiresSponsorship: false,
  genderIdentity: null,
  raceEthnicity: null,
  sexualOrientation: null,
  veteranStatus: null,
  disabilityStatus: null,
  zipCode: null,
  highestEducationLevel: null,
  totalYearsExperience: null,
  requiresRelocationAssistance: false,
  howHeardDefault: null,
  aiPolicyAgreement: null,
  education: [],
  searchCriteria: {
    roleFamilies: ["Business Operations Manager", "Strategy & Operations Manager"],
    locations: ["San Francisco, CA", "Remote - US"],
    industries: ["AI infrastructure", "Cloud infrastructure"],
    salaryFloor: 140000,
  },
  applyDefaults: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies CandidateProfile;

describe("buildDiscoveryQueries", () => {
  beforeEach(() => {
    // Rotation is day-based (Date.now()), so pin the clock for determinism.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 8 rotating role queries plus 3 fixed industry queries (11 total)", () => {
    const queries = buildDiscoveryQueries({ profile: baseProfile });
    expect(queries).toHaveLength(11);
  });

  it("puts the ATS domain filter on every query — not just one, unlike the old pipeline", () => {
    const queries = buildDiscoveryQueries({ profile: baseProfile });
    for (const q of queries) {
      expect(q.domainFilter).toEqual(ATS_DOMAIN_FILTER);
    }
  });

  it("never includes the old 'Avoid these companies' instruction text (moved to the Claude structuring prompt, where it can actually be followed)", () => {
    const queries = buildDiscoveryQueries({ profile: baseProfile });
    for (const q of queries) {
      expect(q.query).not.toContain("Avoid these companies");
    }
  });

  it("keeps the three industry-context queries separate (AI/cloud/infra, energy/climate, defense/govtech) rather than merged into one", () => {
    const queries = buildDiscoveryQueries({ profile: baseProfile });
    const industryQueries = queries.slice(-3);
    expect(industryQueries[0].query).toContain("AI infrastructure, Cloud infrastructure");
    expect(industryQueries[0].query).not.toContain("energy");
    expect(industryQueries[0].query).not.toContain("defense");
    expect(industryQueries[1].query).toContain("energy");
    expect(industryQueries[1].query).toContain("climate");
    expect(industryQueries[1].query).not.toContain("defense");
    expect(industryQueries[2].query).toContain("defense");
    expect(industryQueries[2].query).toContain("govtech");
    expect(industryQueries[2].query).not.toContain("climate");
  });

  it("splits role queries between a fresh track (exact afterDate cutoff) and a backfill track (no recency filter at all)", () => {
    const lastRunDate = new Date("2026-07-24T00:00:00Z");
    const queries = buildDiscoveryQueries({ profile: baseProfile, lastRunDate });
    const roleQueries = queries.slice(0, 8);
    const freshTrack = roleQueries.filter((q) => q.afterDate);
    const backfillTrack = roleQueries.filter((q) => !q.afterDate);
    expect(freshTrack.length).toBeGreaterThan(0);
    expect(backfillTrack.length).toBeGreaterThan(0);
    for (const q of freshTrack) {
      expect(q.afterDate).toBe("07/24/2026");
      expect(q.recencyFilter).toBeUndefined();
    }
    for (const q of backfillTrack) {
      expect(q.recencyFilter).toBeUndefined();
    }
  });

  it("industry queries never carry a recency filter (pure backfill breadth)", () => {
    const lastRunDate = new Date("2026-07-24T00:00:00Z");
    const queries = buildDiscoveryQueries({ profile: baseProfile, lastRunDate });
    const industryQueries = queries.slice(-3);
    for (const q of industryQueries) {
      expect(q.afterDate).toBeUndefined();
      expect(q.recencyFilter).toBeUndefined();
    }
  });

  it("falls back to a month recency bucket on the fresh track when there's no prior run date yet (cold start)", () => {
    const queries = buildDiscoveryQueries({ profile: baseProfile, lastRunDate: null });
    const roleQueries = queries.slice(0, 8);
    const freshTrack = roleQueries.filter((_, i) => i % 2 === 0);
    for (const q of freshTrack) {
      expect(q.afterDate).toBeUndefined();
      expect(q.recencyFilter).toBe("month");
    }
  });

  it("draws a disjoint slice of role phrases for the widen/broaden pass instead of repeating the same queries", () => {
    const normal = buildDiscoveryQueries({ profile: baseProfile }).slice(0, 8).map((q) => q.query);
    const widened = buildDiscoveryQueries({ profile: baseProfile, broaden: true })
      .slice(0, 8)
      .map((q) => q.query);
    const overlap = normal.filter((q) => widened.includes(q));
    expect(overlap.length).toBe(0);
  });

  it("falls back to sensible defaults when search criteria is missing", () => {
    const profile = { ...baseProfile, searchCriteria: null };
    const queries = buildDiscoveryQueries({ profile });
    expect(queries).toHaveLength(11);
    const industryQueries = queries.slice(-3);
    expect(industryQueries[0].query).toContain("AI infrastructure, cloud infrastructure, developer tools");
    for (const q of queries) {
      expect(q.query).toContain("Remote - US");
    }
  });

  it("role queries rotate to a different slice on a different day", () => {
    const day1 = buildDiscoveryQueries({ profile: baseProfile }).slice(0, 8).map((q) => q.query);
    vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
    const day2 = buildDiscoveryQueries({ profile: baseProfile }).slice(0, 8).map((q) => q.query);
    expect(day1).not.toEqual(day2);
  });

  // Rotation used to be keyed to the calendar day, so a second run on the same
  // day fired byte-identical queries. Running the agent several times a day is
  // the normal usage pattern, so every rerun was wasted except for whatever the
  // search engine happened to churn on its own.
  it("rotates between two runs on the SAME day", () => {
    const run1 = buildDiscoveryQueries({ profile: baseProfile, rotationSeed: 100 })
      .slice(0, 8)
      .map((q) => q.query);
    const run2 = buildDiscoveryQueries({ profile: baseProfile, rotationSeed: 101 })
      .slice(0, 8)
      .map((q) => q.query);
    expect(run1).not.toEqual(run2);
    expect(run1.filter((q) => run2.includes(q))).toEqual([]);
  });

  it("gives a run's fresh and widen passes disjoint slices, and the next run a third slice", () => {
    const fresh = buildDiscoveryQueries({ profile: baseProfile, rotationSeed: 100 }).slice(0, 8).map((q) => q.query);
    const widen = buildDiscoveryQueries({ profile: baseProfile, rotationSeed: 100, broaden: true })
      .slice(0, 8)
      .map((q) => q.query);
    const nextFresh = buildDiscoveryQueries({ profile: baseProfile, rotationSeed: 101 })
      .slice(0, 8)
      .map((q) => q.query);
    expect(fresh.filter((q) => widen.includes(q))).toEqual([]);
    expect(nextFresh.filter((q) => fresh.includes(q) || widen.includes(q))).toEqual([]);
  });

  // Advancing the offset by ONE position (the old behaviour) left 7 of 8 phrases
  // shared between consecutive slices, so rotation barely changed the query set
  // even when it did fire.
  it("advances by a whole slice, not one position", () => {
    const a = buildDiscoveryQueries({ profile: baseProfile, rotationSeed: 0 }).slice(0, 8).map((q) => q.query);
    const b = buildDiscoveryQueries({ profile: baseProfile, rotationSeed: 1 }).slice(0, 8).map((q) => q.query);
    expect(a.filter((q) => b.includes(q)).length).toBe(0);
  });

  it("no longer searches for the GTM/revenue/growth families that are out of scope", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 12; seed++) {
      for (const broaden of [false, true]) {
        for (const q of buildDiscoveryQueries({ profile: baseProfile, rotationSeed: seed, broaden })) {
          seen.add(q.query.toLowerCase());
        }
      }
    }
    const all = [...seen].join(" | ");
    expect(all).not.toMatch(/gtm strategy/);
    expect(all).not.toMatch(/revenue operations manager/);
    expect(all).not.toMatch(/growth operations manager/);
    // Sales Ops is explicitly in scope (candidate correction 2026-09-13).
    expect(all).toMatch(/sales operations manager|sales strategy and operations/);
  });

  it("has a pool deep enough that a run does not exhaust it", () => {
    // One run consumes two slices (fresh + widen) = 16 phrases. A 14-phrase pool
    // meant run 1 used everything and every later run that day repeated it.
    const phrases = new Set<string>();
    for (const broaden of [false, true]) {
      for (const q of buildDiscoveryQueries({ profile: baseProfile, rotationSeed: 0, broaden }).slice(0, 8)) {
        phrases.add(q.query);
      }
    }
    expect(phrases.size).toBe(16);
    const later = buildDiscoveryQueries({ profile: baseProfile, rotationSeed: 1 }).slice(0, 8).map((q) => q.query);
    expect(later.some((q) => phrases.has(q))).toBe(false);
  });
});

describe("query phrases come from the role scope, not a hardcoded pool", () => {
  const pmProfile = {
    searchCriteria: {
      roleFamilies: ["Product Manager", "Senior Product Manager"],
      locations: ["Remote"],
      industries: ["AI"],
    },
    applyDefaults: null,
  } as unknown as CandidateProfile;

  it(
    "regression: a non-operations candidate used to pay for queries searching someone else's job. " +
      "The pool was a hardcoded list of ops titles, so a product candidate measured 0 of 8 queries " +
      "mentioning \"product\" on one rotation step — a whole paid run wasted",
    () => {
      // Every rotation step must now stay inside the candidate's function.
      for (const rotationSeed of [0, 1, 2, 3, 4, 5]) {
        const roleQueries = buildDiscoveryQueries({
          profile: pmProfile,
          roleScope: PRODUCT_ROLE_SCOPE,
          rotationSeed,
        }).slice(0, 8);
        const onTarget = roleQueries.filter((q) => /product/i.test(q.query));
        expect(
          onTarget.length,
          `rotation ${rotationSeed} drew ${onTarget.length}/8 on-target queries: ${roleQueries.map((q) => q.query.split(" job posting")[0]).join(" | ")}`
        ).toBe(roleQueries.length);
      }
    }
  );

  it("defaults to the operations pool when no scope is passed, so existing behaviour is unchanged", () => {
    const q = buildDiscoveryQueries({ profile: pmProfile, rotationSeed: 1 }).slice(0, 8);
    // Rotation 1 under the default pool is where the ops titles show up.
    expect(q.some((x) => /operations/i.test(x.query))).toBe(true);
  });
});
