import { describe, expect, it } from "vitest";
import { computePacketReadiness } from "./readiness";

describe("computePacketReadiness", () => {
  it("is no_scan when never scanned and no prompts exist", () => {
    expect(computePacketReadiness({ applicationPromptsScannedAt: null }, [])).toBe("no_scan");
  });

  it("is scanned_empty when scanned and no prompts were found", () => {
    expect(computePacketReadiness({ applicationPromptsScannedAt: new Date() }, [])).toBe(
      "scanned_empty"
    );
  });

  it("is needs_approval when prompts exist but aren't all approved", () => {
    expect(
      computePacketReadiness({ applicationPromptsScannedAt: new Date() }, [
        { status: "needs_draft" },
        { status: "approved" },
      ])
    ).toBe("needs_approval");
  });

  it("is ready when every prompt is approved or submitted", () => {
    expect(
      computePacketReadiness({ applicationPromptsScannedAt: new Date() }, [
        { status: "approved" },
        { status: "submitted" },
      ])
    ).toBe("ready");
  });
});
