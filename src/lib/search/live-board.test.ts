import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectAtsBoard,
  detectEmbeddedGreenhouseBoard,
  fetchGreenhouseJobById,
  fetchLiveBoardJobs,
  matchLiveJob,
} from "./live-board";

describe("detectAtsBoard", () => {
  it("detects a modern Greenhouse job-board URL", () => {
    expect(
      detectAtsBoard("https://job-boards.greenhouse.io/ripple/jobs/7646422")
    ).toEqual({ platform: "greenhouse", boardToken: "ripple" });
  });

  it("detects a legacy Greenhouse boards.greenhouse.io URL", () => {
    expect(
      detectAtsBoard("https://boards.greenhouse.io/acme/jobs/123456")
    ).toEqual({ platform: "greenhouse", boardToken: "acme" });
  });

  it("detects an Ashby job URL by its org slug", () => {
    expect(
      detectAtsBoard("https://jobs.ashbyhq.com/plaid/5d8abedc-018a-4b42-ae1f-0e70b34f2007/application")
    ).toEqual({ platform: "ashby", orgSlug: "plaid" });
  });

  it("returns null for a Greenhouse host without a /jobs/{id} path (generic careers page)", () => {
    expect(detectAtsBoard("https://job-boards.greenhouse.io/acme")).toBeNull();
  });

  it("returns null for an unrecognized platform", () => {
    expect(detectAtsBoard("https://acme.com/careers/some-role")).toBeNull();
  });

  it("returns null for an invalid URL", () => {
    expect(detectAtsBoard("not a url")).toBeNull();
  });
});

describe("fetchLiveBoardJobs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and maps a Greenhouse board's jobs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jobs: [
            { title: "Strategy & Operations Manager", absolute_url: "https://job-boards.greenhouse.io/ripple/jobs/1" },
            { title: "Software Engineer", absolute_url: "https://job-boards.greenhouse.io/ripple/jobs/2" },
          ],
        }),
      })
    );
    const jobs = await fetchLiveBoardJobs({ platform: "greenhouse", boardToken: "ripple" });
    expect(jobs).toEqual([
      { title: "Strategy & Operations Manager", url: "https://job-boards.greenhouse.io/ripple/jobs/1" },
      { title: "Software Engineer", url: "https://job-boards.greenhouse.io/ripple/jobs/2" },
    ]);
  });

  it("fetches and maps an Ashby board's jobs, using jobUrl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jobs: [
            { title: "Strategic Initiatives", jobUrl: "https://jobs.ashbyhq.com/plaid/abc" },
          ],
        }),
      })
    );
    const jobs = await fetchLiveBoardJobs({ platform: "ashby", orgSlug: "plaid" });
    expect(jobs).toEqual([{ title: "Strategic Initiatives", url: "https://jobs.ashbyhq.com/plaid/abc" }]);
  });

  it("falls back to applyUrl for an Ashby job missing jobUrl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jobs: [{ title: "Strategic Initiatives", applyUrl: "https://jobs.ashbyhq.com/plaid/abc/application" }],
        }),
      })
    );
    const jobs = await fetchLiveBoardJobs({ platform: "ashby", orgSlug: "plaid" });
    expect(jobs).toEqual([{ title: "Strategic Initiatives", url: "https://jobs.ashbyhq.com/plaid/abc/application" }]);
  });

  it("returns null on a non-ok response (fail open, not treated as closed)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const jobs = await fetchLiveBoardJobs({ platform: "greenhouse", boardToken: "ripple" });
    expect(jobs).toBeNull();
  });

  it("returns null when fetch throws (network failure, fail open)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const jobs = await fetchLiveBoardJobs({ platform: "ashby", orgSlug: "plaid" });
    expect(jobs).toBeNull();
  });
});

describe("matchLiveJob", () => {
  const jobs = [
    { title: "Strategy & Operations Manager", url: "https://example.com/jobs/1" },
    { title: "Software Engineer", url: "https://example.com/jobs/2" },
  ];

  it("finds an exact title match", () => {
    expect(matchLiveJob(jobs, "Strategy & Operations Manager")).toEqual(jobs[0]);
  });

  it("finds a fuzzy match for a lightly reworded/renamed title", () => {
    expect(matchLiveJob(jobs, "Senior Strategy & Operations Manager")).toEqual(jobs[0]);
  });

  it("returns null when no live job matches", () => {
    expect(matchLiveJob(jobs, "Product Manager")).toBeNull();
  });
});

describe("detectEmbeddedGreenhouseBoard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const BUILDOPS_URL = "https://buildops.com/careers/job-application?gh_jid=6100196004";

  it("extracts the board token from the embed script's for= param (real case: BuildOps)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          '<html><body><script src="https://greenhouse.io/embed/job_board/js?for=buildops"></script></body></html>',
      })
    );
    const result = await detectEmbeddedGreenhouseBoard(BUILDOPS_URL);
    expect(result).toEqual({ platform: "greenhouse", boardToken: "buildops", jobId: "6100196004" });
  });

  it("returns null when the URL has no gh_jid param (no network call made)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await detectEmbeddedGreenhouseBoard("https://buildops.com/careers");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the page has no Greenhouse embed script", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => "<html><body>No embed here</body></html>" })
    );
    const result = await detectEmbeddedGreenhouseBoard(BUILDOPS_URL);
    expect(result).toBeNull();
  });

  it("returns null on a non-ok response (fail open)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await detectEmbeddedGreenhouseBoard(BUILDOPS_URL);
    expect(result).toBeNull();
  });

  it("returns null when fetch throws (fail open)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const result = await detectEmbeddedGreenhouseBoard(BUILDOPS_URL);
    expect(result).toBeNull();
  });
});

describe("fetchGreenhouseJobById", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the job when found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          title: "Strategic Initiatives",
          absolute_url: "https://buildops.com/careers/job-application?gh_jid=6100196004",
        }),
      })
    );
    const result = await fetchGreenhouseJobById("buildops", "6100196004");
    expect(result).toEqual({
      status: "found",
      job: { title: "Strategic Initiatives", url: "https://buildops.com/careers/job-application?gh_jid=6100196004" },
    });
  });

  it("returns closed on a 404 (authoritative, not a network failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const result = await fetchGreenhouseJobById("buildops", "999999");
    expect(result).toEqual({ status: "closed" });
  });

  it("returns error on other non-ok statuses (fail open, distinct from closed)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await fetchGreenhouseJobById("buildops", "6100196004");
    expect(result).toEqual({ status: "error" });
  });

  it("returns error when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const result = await fetchGreenhouseJobById("buildops", "6100196004");
    expect(result).toEqual({ status: "error" });
  });
});
