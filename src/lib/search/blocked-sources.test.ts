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

  it("does not block a legitimate free-to-apply source", () => {
    expect(
      isBlockedSource("https://job-boards.greenhouse.io/anthropic/jobs/5138044008")
    ).toBe(false);
  });

  it("returns false (doesn't block) for an unparseable URL", () => {
    expect(isBlockedSource("not-a-url")).toBe(false);
  });
});
