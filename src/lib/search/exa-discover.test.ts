import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateProfile } from "@/lib/db/schema";
import { buildDiscoveryQueries, ATS_DOMAIN_FILTER } from "./perplexity-discover";
import { discoverCandidatePostingsExa } from "./exa-discover";

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

type FetchArgs = [string, RequestInit];

/** Reads the JSON body out of a recorded fetch call. */
function bodyOf(mock: { mock: { calls: unknown[][] } }, i: number): Record<string, unknown> {
  const call = mock.mock.calls[i] as FetchArgs;
  return JSON.parse(call[1].body as string);
}

function mockExaOk(results: unknown[] = [], costTotal = 0.017) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ results, costDollars: { total: costTotal } }), { status: 200 })
  );
}

describe("discoverCandidatePostingsExa", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));
    process.env.EXA_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.EXA_API_KEY;
  });

  it("skips cleanly with a warning when EXA_API_KEY is unset, rather than throwing", async () => {
    delete process.env.EXA_API_KEY;
    const res = await discoverCandidatePostingsExa({ profile: baseProfile });
    expect(res.warning).toMatch(/EXA_API_KEY is not set/);
    expect(res.citations).toEqual([]);
    expect(res.requestCount).toBe(0);
  });

  it("fires exactly the same query text as the Perplexity arm — the A/B's core assumption", async () => {
    const fetchMock = mockExaOk();
    vi.stubGlobal("fetch", fetchMock);

    await discoverCandidatePostingsExa({ profile: baseProfile });

    const expected = buildDiscoveryQueries({ profile: baseProfile }).map((q) => q.query);
    const actual = fetchMock.mock.calls.map(
      (_c, i) => bodyOf(fetchMock, i).query
    );
    expect(actual).toEqual(expected);
  });

  it("sends the ATS domain filter as includeDomains on every request", async () => {
    const fetchMock = mockExaOk();
    vi.stubGlobal("fetch", fetchMock);

    await discoverCandidatePostingsExa({ profile: baseProfile });

    fetchMock.mock.calls.forEach((_c, i) => {
      const body = bodyOf(fetchMock, i);
      expect(body.includeDomains).toEqual(ATS_DOMAIN_FILTER);
      expect(body.numResults).toBe(20);
    });
  });

  it("omits excludeDomains by default so the parity arm stays apples-to-apples", async () => {
    const fetchMock = mockExaOk();
    vi.stubGlobal("fetch", fetchMock);

    await discoverCandidatePostingsExa({ profile: baseProfile });

    expect(bodyOf(fetchMock, 0).excludeDomains).toBeUndefined();
  });

  it("sends excludeDomains only when explicitly opted in (the Exa-tuned arm)", async () => {
    const fetchMock = mockExaOk();
    vi.stubGlobal("fetch", fetchMock);

    await discoverCandidatePostingsExa({
      profile: baseProfile,
      excludeDomains: ["linkedin.com"],
    });

    expect(bodyOf(fetchMock, 0).excludeDomains).toEqual(["linkedin.com"]);
  });

  it("converts Perplexity's MM/DD/YYYY afterDate into Exa's ISO startPublishedDate", async () => {
    const fetchMock = mockExaOk();
    vi.stubGlobal("fetch", fetchMock);

    await discoverCandidatePostingsExa({
      profile: baseProfile,
      lastRunDate: new Date("2026-07-01T00:00:00Z"),
    });

    const bodies = fetchMock.mock.calls.map((_c, i) => bodyOf(fetchMock, i));
    const dated = bodies.filter((b) => b.startPublishedDate) as Array<{ startPublishedDate: string }>;
    expect(dated.length).toBeGreaterThan(0);
    for (const b of dated) {
      expect(b.startPublishedDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Number.isNaN(Date.parse(b.startPublishedDate))).toBe(false);
    }
  });

  it("reports Exa's own costDollars rather than a modelled estimate", async () => {
    vi.stubGlobal("fetch", mockExaOk([], 0.017));
    const res = await discoverCandidatePostingsExa({ profile: baseProfile });
    // 11 queries x $0.017 self-reported
    expect(res.costUsd).toBeCloseTo(11 * 0.017, 5);
  });

  it("dedupes citations across queries", async () => {
    vi.stubGlobal(
      "fetch",
      mockExaOk([
        { title: "A", url: "https://jobs.ashbyhq.com/acme/1" },
        { title: "A dup", url: "https://jobs.ashbyhq.com/acme/1" },
      ])
    );
    const res = await discoverCandidatePostingsExa({ profile: baseProfile });
    expect(res.citations).toEqual(["https://jobs.ashbyhq.com/acme/1"]);
  });

  it("surfaces a warning but still returns partial results when some queries fail", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n += 1;
        if (n === 1) return new Response("rate limited", { status: 429 });
        return new Response(
          JSON.stringify({
            results: [{ title: "Ok", url: `https://jobs.lever.co/co/${n}` }],
            costDollars: { total: 0.017 },
          }),
          { status: 200 }
        );
      })
    );

    const res = await discoverCandidatePostingsExa({ profile: baseProfile });
    expect(res.warning).toMatch(/1 of 11 Exa discovery queries failed/);
    expect(res.citations.length).toBeGreaterThan(0);
  });
});
