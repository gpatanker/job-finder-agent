import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateProfile } from "@/lib/db/schema";
import { ATS_DOMAIN_FILTER, buildDiscoveryQueries } from "./perplexity-discover";

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
});
