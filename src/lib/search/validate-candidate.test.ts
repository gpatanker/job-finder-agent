import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCandidateUrl } from "./validate-candidate";

describe("checkCandidateUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a blocked source before any network call", async () => {
    const result = await checkCandidateUrl(
      "https://www.theladders.com/job/some-role",
      "Some Role"
    );
    expect(result).toEqual({ ok: false, reason: "blocked" });
  });

  it("rejects a generic careers-page link before any network call", async () => {
    const result = await checkCandidateUrl("https://acme.com/careers", "Some Role");
    expect(result).toEqual({ ok: false, reason: "generic" });
  });

  it("rejects a closed posting (404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "" })
    );
    const result = await checkCandidateUrl("https://acme.com/careers/role-123", "Some Role");
    expect(result).toEqual({ ok: false, reason: "closed" });
  });

  it("rejects a bot-blocked posting (403) as unverifiable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const result = await checkCandidateUrl("https://acme.com/careers/role-123", "Some Role");
    expect(result).toEqual({ ok: false, reason: "unverifiable" });
  });

  it("passes a live, specific posting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "<body><h1>Some Role</h1><p>Apply now</p></body>",
      })
    );
    const result = await checkCandidateUrl("https://acme.com/careers/role-123", "Some Role");
    expect(result).toEqual({ ok: true });
  });
});
