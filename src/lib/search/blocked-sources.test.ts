import { describe, expect, it } from "vitest";
import { isBlockedSource } from "./blocked-sources";

describe("isBlockedSource", () => {
  it("blocks the exact real case: TheLadders, which paywalls the actual apply action behind Apply4Me", () => {
    expect(
      isBlockedSource(
        "https://www.theladders.com/job/senior-manager-business-operations-crusoe-new-york-ny_87267114"
      )
    ).toBe(true);
  });

  it("blocks the bare theladders.com hostname without www", () => {
    expect(isBlockedSource("https://theladders.com/job/whatever_123")).toBe(true);
  });

  it("blocks ZipRecruiter (excluded per user direction — paywall/quality issues)", () => {
    expect(isBlockedSource("https://www.ziprecruiter.com/jobs/some-role")).toBe(true);
    expect(isBlockedSource("https://ziprecruiter.com/jobs/some-role")).toBe(true);
  });

  it("blocks BuiltIn's national site and its regional sites by pattern (excluded per user direction)", () => {
    expect(isBlockedSource("https://builtin.com/job/some-role")).toBe(true);
    expect(isBlockedSource("https://www.builtin.com/job/some-role")).toBe(true);
    expect(isBlockedSource("https://www.builtinsf.com/job/some-role")).toBe(true);
    expect(isBlockedSource("https://builtinnyc.com/job/some-role")).toBe(true);
    expect(isBlockedSource("https://www.builtinchicago.org/job/some-role")).toBe(true);
  });

  it("does not block an unrelated hostname that merely contains 'built'", () => {
    expect(isBlockedSource("https://rebuilt.com/job/some-role")).toBe(false);
  });

  it(
    "blocks Welcome to the Jungle across its subdomains (excluded per user direction) — " +
      "real case: the exact reported Crusoe posting URL",
    () => {
      expect(
        isBlockedSource(
          "https://www.welcometothejungle.com/en/companies/crusoe-energy-systems/jobs/strategy-and-operations-associate_san-francisco_2kjx6mwq"
        )
      ).toBe(true);
      expect(isBlockedSource("https://app.welcometothejungle.com/jobs/oKrWWOxJ")).toBe(true);
      expect(isBlockedSource("https://welcometothejungle.com/jobs/some-role")).toBe(true);
    }
  );

  it("does not block an unrelated hostname that merely contains the phrase as a prefix", () => {
    expect(isBlockedSource("https://notwelcometothejungle.com/jobs/some-role")).toBe(false);
  });

  it("does not block a legitimate free-to-apply source", () => {
    expect(
      isBlockedSource("https://job-boards.greenhouse.io/anthropic/jobs/5138044008")
    ).toBe(false);
  });

  it("returns false (doesn't block) for an unparseable URL", () => {
    expect(isBlockedSource("not-a-url")).toBe(false);
  });
});
