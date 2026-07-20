import { describe, expect, it } from "vitest";
import { looksLikeGenericCareersPage } from "./specificity-check";

describe("looksLikeGenericCareersPage", () => {
  it("flags the exact real case: a bare /join-us/ landing page", () => {
    expect(looksLikeGenericCareersPage("https://snorkel.ai/join-us/")).toBe(true);
  });

  it("flags a bare /careers page with no further path", () => {
    expect(looksLikeGenericCareersPage("https://example.com/careers")).toBe(true);
    expect(looksLikeGenericCareersPage("https://example.com/careers/")).toBe(true);
  });

  it("flags the bare domain root", () => {
    expect(looksLikeGenericCareersPage("https://example.com/")).toBe(true);
  });

  it("does not flag a Greenhouse deep link with a job ID", () => {
    expect(
      looksLikeGenericCareersPage("https://job-boards.greenhouse.io/snorkelai/jobs/5689470004")
    ).toBe(false);
  });

  it("does not flag a company career-site URL with a role-specific slug", () => {
    expect(
      looksLikeGenericCareersPage("https://openai.com/careers/business-operations-manager-san-francisco/")
    ).toBe(false);
  });

  it("returns false (doesn't block) for an unparseable URL", () => {
    expect(looksLikeGenericCareersPage("not-a-url")).toBe(false);
  });

  it("does not flag a bare /careers path carrying an ashby_jid query param (real case: emeraldai.co)", () => {
    expect(
      looksLikeGenericCareersPage(
        "https://www.emeraldai.co/careers?ashby_jid=21596d2f-8ddb-4131-bd03-1d338e32e679"
      )
    ).toBe(false);
  });

  it("does not flag a bare careers path carrying a gh_jid query param", () => {
    expect(looksLikeGenericCareersPage("https://acme.com/careers?gh_jid=7646422")).toBe(false);
  });

  it("still flags a bare /careers page with unrelated query params", () => {
    expect(looksLikeGenericCareersPage("https://example.com/careers?utm_source=linkedin")).toBe(true);
  });
});
