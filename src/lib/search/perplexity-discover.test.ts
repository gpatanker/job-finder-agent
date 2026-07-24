import { describe, expect, it } from "vitest";
import type { CandidateProfile } from "@/lib/db/schema";
import { buildDiscoveryQueries } from "./perplexity-discover";

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
  it("returns 6 distinct queries covering core roles, synonyms, AI/cloud/infra industries, direct ATS postings, energy/climate, and defense/govtech", () => {
    const queries = buildDiscoveryQueries({ profile: baseProfile, overrepresentedCompanies: [] });
    expect(queries).toHaveLength(6);
    expect(queries[0].query).toContain("Business Operations Manager, Strategy & Operations Manager");
    expect(queries[0].query).toContain("San Francisco, CA, Remote - US");
    expect(queries[1].query).toContain("Revenue Operations Manager");
    expect(queries[2].query).toContain("AI infrastructure, Cloud infrastructure");
    expect(queries[2].query).toContain("cybersecurity");
    expect(queries[2].query).toContain("AI/ML company");
    expect(queries[4].query).toContain("energy");
    expect(queries[4].query).toContain("climate tech");
    expect(queries[5].query).toContain("defense");
    expect(queries[5].query).toContain("govtech");
  });

  it("keeps the AI/cloud/infra query separate from energy/climate and defense/govtech (no cross-contamination)", () => {
    const queries = buildDiscoveryQueries({ profile: baseProfile, overrepresentedCompanies: [] });
    expect(queries[2].query).not.toContain("energy");
    expect(queries[2].query).not.toContain("defense");
    expect(queries[2].query).not.toContain("govtech");
    expect(queries[4].query).not.toContain("defense");
    expect(queries[5].query).not.toContain("climate tech");
  });

  it("only sets a domain filter on the direct-ATS-postings query", () => {
    const queries = buildDiscoveryQueries({ profile: baseProfile, overrepresentedCompanies: [] });
    expect(queries[0].domainFilter).toBeUndefined();
    expect(queries[1].domainFilter).toBeUndefined();
    expect(queries[2].domainFilter).toBeUndefined();
    expect(queries[3].domainFilter).toEqual(["job-boards.greenhouse.io", "jobs.ashbyhq.com"]);
    expect(queries[4].domainFilter).toBeUndefined();
    expect(queries[5].domainFilter).toBeUndefined();
  });

  it("falls back to sensible defaults when search criteria is missing", () => {
    const profile = { ...baseProfile, searchCriteria: null };
    const queries = buildDiscoveryQueries({ profile, overrepresentedCompanies: [] });
    expect(queries[0].query).toContain("Business Operations Manager");
    expect(queries[0].query).toContain("Remote - US");
    expect(queries[2].query).toContain("AI infrastructure, cloud infrastructure, developer tools");
  });

  it("appends a deprioritization clause for overrepresented companies to every query", () => {
    const queries = buildDiscoveryQueries({
      profile: baseProfile,
      overrepresentedCompanies: ["Anthropic (5 prior suggestions)"],
    });
    for (const q of queries) {
      expect(q.query).toContain("Avoid these companies");
      expect(q.query).toContain("Anthropic (5 prior suggestions)");
    }
  });

  it("does not include a deprioritization clause when nothing is overrepresented", () => {
    const queries = buildDiscoveryQueries({ profile: baseProfile, overrepresentedCompanies: [] });
    for (const q of queries) {
      expect(q.query).not.toContain("Avoid these companies");
    }
  });

  it("adds a broadening note to every query except the ATS-specific one when broaden is true", () => {
    const queries = buildDiscoveryQueries({
      profile: baseProfile,
      overrepresentedCompanies: [],
      broaden: true,
    });
    expect(queries[0].query).toContain("Focus on adjacent industries");
    expect(queries[1].query).toContain("Focus on adjacent industries");
    expect(queries[2].query).toContain("Focus on adjacent industries");
    expect(queries[3].query).not.toContain("Focus on adjacent industries");
    expect(queries[4].query).toContain("Focus on adjacent industries");
    expect(queries[5].query).toContain("Focus on adjacent industries");
  });
});
