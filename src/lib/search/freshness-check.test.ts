import { afterEach, describe, expect, it, vi } from "vitest";
import {
  htmlIndicatesClosedPosting,
  isLikelyBotBlocked,
  isLikelyClosed,
  pageMentionsTitle,
} from "./freshness-check";

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

describe("pageMentionsTitle", () => {
  it("regression: a company's general 'Current Openings' board does not mention a specific closed role (real case: Fireworks AI redirected a dead job-ID link to its general board)", () => {
    const html = `<html><body>
      <h1>Current Openings</h1>
      <p>The job you are looking for is no longer open.</p>
      <h2>Revenue Accounting Lead</h2>
      <h2>Senior GRC Specialist</h2>
      <h2>Business Development Representative</h2>
    </body></html>`;
    expect(pageMentionsTitle(html, "Financial & Business Operations Analyst")).toBe(false);
  });

  it("is not fooled by partial keyword overlap alone (stricter than keyword matching)", () => {
    // Contains "business" and "operations" individually, but not the phrase
    const html = `<body><h2>Business Development Representative</h2><h2>Go To Market Operations</h2></body>`;
    expect(pageMentionsTitle(html, "Financial & Business Operations Analyst")).toBe(false);
  });

  it("returns true when the page actually contains the role's title", () => {
    const html = `<body><h1>Technical Program Manager, Compute</h1><p>Apply now</p></body>`;
    expect(pageMentionsTitle(html, "Technical Program Manager, Compute")).toBe(true);
  });

  it("does not block when no title is given to check against", () => {
    expect(pageMentionsTitle("<body>anything</body>", "")).toBe(true);
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

  it("regression: flags a 200 response that silently redirected to a general careers board (title check catches what phrase-matching can't, since the closed banner is client-side rendered and invisible to a plain fetch)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "<body><h1>Current Openings</h1><h2>Revenue Accounting Lead</h2></body>",
      })
    );
    expect(
      await isLikelyClosed(
        "https://job-boards.greenhouse.io/fireworksai/jobs/4204418009",
        "Financial & Business Operations Analyst"
      )
    ).toBe(true);
  });

  it("does not flag a live posting whose page contains its own title", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "<body><h1>Technical Program Manager, Compute</h1></body>",
      })
    );
    expect(
      await isLikelyClosed(
        "https://job-boards.greenhouse.io/anthropic/jobs/5138044008",
        "Technical Program Manager, Compute"
      )
    ).toBe(false);
  });

  it("skips the title check entirely when no title is passed (backward compatible)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "<body>Completely unrelated content</body>",
      })
    );
    expect(await isLikelyClosed("https://example.com/no-title-given")).toBe(false);
  });
});

describe("isLikelyBotBlocked", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    "regression: flags a 403 as bot-blocked rather than assuming the page confirmed open " +
      "(real case: OpenAI's Cloudflare challenge returned 403 for a posting whose real, " +
      "browser-rendered page was a genuine custom 404 — isLikelyClosed alone silently passed it through)",
    async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "<html>challenge page</html>" })
      );
      expect(await isLikelyBotBlocked("https://openai.com/careers/some-role")).toBe(true);
    }
  );

  it("flags 429 (rate limited) and 503 (often a bot-mitigation status) as blocked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    expect(await isLikelyBotBlocked("https://example.com/rate-limited")).toBe(true);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    expect(await isLikelyBotBlocked("https://example.com/service-unavailable")).toBe(true);
  });

  it("does not flag a normal 200 or a plain 404 as bot-blocked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    expect(await isLikelyBotBlocked("https://example.com/live-page")).toBe(false);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await isLikelyBotBlocked("https://example.com/genuinely-gone")).toBe(false);
  });

  it("defaults to not-blocked when the fetch throws (network error, timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await isLikelyBotBlocked("https://example.com/unreachable")).toBe(false);
  });
});
