import { describe, expect, it } from "vitest";
import { companyKeyFor, formatCompanyContext } from "./company-context";
import type { CompanyProfile } from "@/lib/db/schema";

const profile = (over: Partial<CompanyProfile> = {}): CompanyProfile =>
  ({
    id: "1",
    companyKey: "google",
    companyName: "Google",
    summary: "Google builds search, ads and cloud infrastructure.",
    domains: ["cloud computing", "AI/ML infrastructure"],
    valuedSignals: ["large-scale capacity planning", "vendor management"],
    sourceUrls: [],
    estimatedCostUsd: 0.01,
    researchedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as CompanyProfile;

describe("companyKeyFor", () => {
  it("collapses punctuation and case so one employer is cached once", () => {
    expect(companyKeyFor("Google")).toBe(companyKeyFor("google"));
    expect(companyKeyFor("Motive (Gomotive)")).toBe("motivegomotive");
    expect(companyKeyFor("SpaceX (xAI)")).toBe("spacexxai");
  });

  it("returns an empty key for a nameless company, which callers treat as no-op", () => {
    expect(companyKeyFor("   ")).toBe("");
  });
});

describe("formatCompanyContext", () => {
  it("returns an empty string when there is no profile, so the prompt is unchanged", () => {
    expect(formatCompanyContext(null)).toBe("");
  });

  it("includes the summary, domains and valued signals", () => {
    const out = formatCompanyContext(profile());
    expect(out).toContain("ABOUT GOOGLE:");
    expect(out).toContain("cloud computing");
    expect(out).toContain("large-scale capacity planning");
  });

  it("tells the agent not to claim anything the bullets don't support", () => {
    expect(formatCompanyContext(profile())).toMatch(/Do not claim anything the bullets don't already support/);
  });

  it("omits the signals line entirely when research found none", () => {
    const out = formatCompanyContext(profile({ valuedSignals: [] }));
    expect(out).not.toMatch(/Likely valued/);
    expect(out).toContain("ABOUT GOOGLE:");
  });
});
