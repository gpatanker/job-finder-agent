import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlIndicatesClosedPosting, isLikelyClosed } from "./freshness-check";

describe("htmlIndicatesClosedPosting", () => {
  it("detects the exact banner seen on a real closed aggregator listing", () => {
    const html = `<html><body>
      <div class="banner">This job post is closed and the position is probably filled. Please do not apply.</div>
      <h1>Senior Business Operations Manager</h1>
    </body></html>`;
    expect(htmlIndicatesClosedPosting(html)).toBe(true);
  });

  it("detects common ATS closed-posting phrasing", () => {
    expect(
      htmlIndicatesClosedPosting("<body>This position is no longer accepting applications.</body>")
    ).toBe(true);
  });

  it("returns false for a normal open posting", () => {
    const html = `<html><body>
      <h1>Business Operations Manager</h1>
      <p>We are looking for a candidate to join our team.</p>
      <button>Apply now</button>
    </body></html>`;
    expect(htmlIndicatesClosedPosting(html)).toBe(false);
  });
});

describe("isLikelyClosed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats a 404 response as closed even if the body text alone wouldn't match (regression: real-world aggregators return 404 + a closed banner)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "<html><body>Not found</body></html>",
      })
    );
    expect(await isLikelyClosed("https://example.com/closed-job")).toBe(true);
  });

  it("treats a 410 Gone response as closed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 410, text: async () => "" })
    );
    expect(await isLikelyClosed("https://example.com/gone-job")).toBe(true);
  });

  it("defaults to not-closed on other non-OK statuses without scanning the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "" })
    );
    expect(await isLikelyClosed("https://example.com/server-error")).toBe(false);
  });

  it("scans body text for closed phrasing on a 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "<body>This job is no longer available.</body>",
      })
    );
    expect(await isLikelyClosed("https://example.com/live-page-closed-posting")).toBe(true);
  });

  it("defaults to not-closed when the fetch throws (network error, timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error"))
    );
    expect(await isLikelyClosed("https://example.com/unreachable")).toBe(false);
  });
});
