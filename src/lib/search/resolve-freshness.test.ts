import { describe, expect, it, vi, beforeEach } from "vitest";

const { fetchLiveBoardJobsMock } = vi.hoisted(() => ({ fetchLiveBoardJobsMock: vi.fn() }));
const { detectEmbeddedGreenhouseBoardMock } = vi.hoisted(() => ({ detectEmbeddedGreenhouseBoardMock: vi.fn() }));
const { fetchGreenhouseJobByIdMock } = vi.hoisted(() => ({ fetchGreenhouseJobByIdMock: vi.fn() }));
const { checkCandidateUrlMock } = vi.hoisted(() => ({ checkCandidateUrlMock: vi.fn() }));
const { findDirectSourceUrlMock } = vi.hoisted(() => ({ findDirectSourceUrlMock: vi.fn() }));

vi.mock("./live-board", async () => {
  const actual = await vi.importActual<typeof import("./live-board")>("./live-board");
  return {
    ...actual,
    fetchLiveBoardJobs: fetchLiveBoardJobsMock,
    detectEmbeddedGreenhouseBoard: detectEmbeddedGreenhouseBoardMock,
    fetchGreenhouseJobById: fetchGreenhouseJobByIdMock,
  };
});
vi.mock("./validate-candidate", () => ({ checkCandidateUrl: checkCandidateUrlMock }));
vi.mock("./find-direct-source", () => ({ findDirectSourceUrl: findDirectSourceUrlMock }));

import { resolveCandidateFreshness, type LiveBoardCache } from "./resolve-freshness";

const GREENHOUSE_URL = "https://job-boards.greenhouse.io/ripple/jobs/1";
const BUILDOPS_URL = "https://buildops.com/careers/job-application?gh_jid=6100196004";

describe("resolveCandidateFreshness", () => {
  let cache: LiveBoardCache;

  beforeEach(() => {
    cache = new Map();
    fetchLiveBoardJobsMock.mockReset();
    detectEmbeddedGreenhouseBoardMock.mockReset().mockResolvedValue(null);
    fetchGreenhouseJobByIdMock.mockReset();
    checkCandidateUrlMock.mockReset();
    findDirectSourceUrlMock.mockReset();
  });

  it("confirms a Greenhouse candidate found live, without any LLM recovery call", async () => {
    fetchLiveBoardJobsMock.mockResolvedValue([
      { title: "Strategy & Operations Manager", url: GREENHOUSE_URL },
    ]);

    const result = await resolveCandidateFreshness({
      applyUrl: GREENHOUSE_URL,
      sourceUrl: GREENHOUSE_URL,
      title: "Strategy & Operations Manager",
      company: "Ripple",
      liveBoardCache: cache,
    });

    expect(result).toEqual({
      ok: true,
      applyUrl: GREENHOUSE_URL,
      sourceUrl: GREENHOUSE_URL,
      recovered: false,
      verifiedLive: true,
    });
    expect(checkCandidateUrlMock).not.toHaveBeenCalled();
    expect(findDirectSourceUrlMock).not.toHaveBeenCalled();
  });

  it("uses the live listing's own (renamed) URL/title and flags it recovered when different", async () => {
    const renamedUrl = "https://job-boards.greenhouse.io/ripple/jobs/2";
    fetchLiveBoardJobsMock.mockResolvedValue([
      { title: "Senior Strategy & Operations Manager", url: renamedUrl },
    ]);

    const result = await resolveCandidateFreshness({
      applyUrl: GREENHOUSE_URL,
      sourceUrl: GREENHOUSE_URL,
      title: "Strategy & Operations Manager",
      company: "Ripple",
      liveBoardCache: cache,
    });

    expect(result).toEqual({
      ok: true,
      applyUrl: renamedUrl,
      sourceUrl: renamedUrl,
      recovered: true,
      verifiedLive: true,
    });
    expect(findDirectSourceUrlMock).not.toHaveBeenCalled();
  });

  it("treats a Greenhouse candidate missing from the live list as closed, with no LLM recovery call", async () => {
    fetchLiveBoardJobsMock.mockResolvedValue([
      { title: "Software Engineer", url: "https://job-boards.greenhouse.io/ripple/jobs/9" },
    ]);

    const result = await resolveCandidateFreshness({
      applyUrl: GREENHOUSE_URL,
      sourceUrl: GREENHOUSE_URL,
      title: "Strategy & Operations Manager",
      company: "Ripple",
      liveBoardCache: cache,
    });

    expect(result).toEqual({ ok: false, reason: "closed" });
    expect(checkCandidateUrlMock).not.toHaveBeenCalled();
    expect(findDirectSourceUrlMock).not.toHaveBeenCalled();
  });

  it("falls back to the existing per-page check for an unrecognized platform", async () => {
    checkCandidateUrlMock.mockResolvedValue({ ok: true });

    const result = await resolveCandidateFreshness({
      applyUrl: "https://acme.com/careers/role-123",
      sourceUrl: "https://acme.com/careers/role-123",
      title: "Some Role",
      company: "Acme",
      liveBoardCache: cache,
    });

    expect(result).toEqual({
      ok: true,
      applyUrl: "https://acme.com/careers/role-123",
      sourceUrl: "https://acme.com/careers/role-123",
      recovered: false,
      verifiedLive: false,
    });
    expect(fetchLiveBoardJobsMock).not.toHaveBeenCalled();
    expect(checkCandidateUrlMock).toHaveBeenCalledWith("https://acme.com/careers/role-123", "Some Role");
  });

  it("falls back to the existing pipeline (with recovery) when the live-board fetch itself fails", async () => {
    fetchLiveBoardJobsMock.mockResolvedValue(null);
    findDirectSourceUrlMock.mockResolvedValue("https://job-boards.greenhouse.io/ripple/jobs/3");
    checkCandidateUrlMock.mockResolvedValueOnce({ ok: false, reason: "closed" });
    checkCandidateUrlMock.mockResolvedValueOnce({ ok: true });

    const result = await resolveCandidateFreshness({
      applyUrl: GREENHOUSE_URL,
      sourceUrl: GREENHOUSE_URL,
      title: "Strategy & Operations Manager",
      company: "Ripple",
      liveBoardCache: cache,
    });

    expect(result).toEqual({
      ok: true,
      applyUrl: "https://job-boards.greenhouse.io/ripple/jobs/3",
      sourceUrl: "https://job-boards.greenhouse.io/ripple/jobs/3",
      recovered: true,
      verifiedLive: false,
    });
    expect(findDirectSourceUrlMock).toHaveBeenCalledWith({ company: "Ripple", title: "Strategy & Operations Manager" });
  });

  it("propagates the final failure reason when recovery also fails", async () => {
    checkCandidateUrlMock.mockResolvedValue({ ok: false, reason: "generic" });
    findDirectSourceUrlMock.mockResolvedValue(null);

    const result = await resolveCandidateFreshness({
      applyUrl: "https://acme.com/careers",
      sourceUrl: "https://acme.com/careers",
      title: "Some Role",
      company: "Acme",
      liveBoardCache: cache,
    });

    expect(result).toEqual({ ok: false, reason: "generic" });
  });

  it("shares one live-board fetch across concurrent candidates from the same company (cache hit)", async () => {
    let resolveFetch!: (jobs: { title: string; url: string }[]) => void;
    fetchLiveBoardJobsMock.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; })
    );

    const call1 = resolveCandidateFreshness({
      applyUrl: GREENHOUSE_URL,
      sourceUrl: GREENHOUSE_URL,
      title: "Strategy & Operations Manager",
      company: "Ripple",
      liveBoardCache: cache,
    });
    const call2 = resolveCandidateFreshness({
      applyUrl: "https://job-boards.greenhouse.io/ripple/jobs/4",
      sourceUrl: "https://job-boards.greenhouse.io/ripple/jobs/4",
      title: "Software Engineer",
      company: "Ripple",
      liveBoardCache: cache,
    });

    resolveFetch([
      { title: "Strategy & Operations Manager", url: GREENHOUSE_URL },
      { title: "Software Engineer", url: "https://job-boards.greenhouse.io/ripple/jobs/4" },
    ]);
    await Promise.all([call1, call2]);

    expect(fetchLiveBoardJobsMock).toHaveBeenCalledTimes(1);
  });

  it("confirms an embedded Greenhouse widget posting (real case: BuildOps), without any LLM recovery call", async () => {
    detectEmbeddedGreenhouseBoardMock.mockResolvedValue({
      platform: "greenhouse",
      boardToken: "buildops",
      jobId: "6100196004",
    });
    fetchGreenhouseJobByIdMock.mockResolvedValue({ status: "found", job: { title: "Strategic Initiatives", url: BUILDOPS_URL } });

    const result = await resolveCandidateFreshness({
      applyUrl: BUILDOPS_URL,
      sourceUrl: BUILDOPS_URL,
      title: "Strategic Initiatives",
      company: "BuildOps",
      liveBoardCache: cache,
    });

    expect(result).toEqual({
      ok: true,
      applyUrl: BUILDOPS_URL,
      sourceUrl: BUILDOPS_URL,
      recovered: false,
      verifiedLive: true,
    });
    expect(fetchGreenhouseJobByIdMock).toHaveBeenCalledWith("buildops", "6100196004");
    expect(checkCandidateUrlMock).not.toHaveBeenCalled();
    expect(findDirectSourceUrlMock).not.toHaveBeenCalled();
  });

  it("treats an embedded Greenhouse posting confirmed 404 as closed, with no LLM recovery call", async () => {
    detectEmbeddedGreenhouseBoardMock.mockResolvedValue({
      platform: "greenhouse",
      boardToken: "buildops",
      jobId: "999999",
    });
    fetchGreenhouseJobByIdMock.mockResolvedValue({ status: "closed" });

    const result = await resolveCandidateFreshness({
      applyUrl: "https://buildops.com/careers/job-application?gh_jid=999999",
      sourceUrl: "https://buildops.com/careers/job-application?gh_jid=999999",
      title: "Some Old Role",
      company: "BuildOps",
      liveBoardCache: cache,
    });

    expect(result).toEqual({ ok: false, reason: "closed" });
    expect(checkCandidateUrlMock).not.toHaveBeenCalled();
    expect(findDirectSourceUrlMock).not.toHaveBeenCalled();
  });

  it("falls back to the existing pipeline when the embedded-board lookup itself errors", async () => {
    detectEmbeddedGreenhouseBoardMock.mockResolvedValue({
      platform: "greenhouse",
      boardToken: "buildops",
      jobId: "6100196004",
    });
    fetchGreenhouseJobByIdMock.mockResolvedValue({ status: "error" });
    checkCandidateUrlMock.mockResolvedValue({ ok: true });

    const result = await resolveCandidateFreshness({
      applyUrl: BUILDOPS_URL,
      sourceUrl: BUILDOPS_URL,
      title: "Strategic Initiatives",
      company: "BuildOps",
      liveBoardCache: cache,
    });

    expect(result).toEqual({
      ok: true,
      applyUrl: BUILDOPS_URL,
      sourceUrl: BUILDOPS_URL,
      recovered: false,
      verifiedLive: false,
    });
    expect(checkCandidateUrlMock).toHaveBeenCalledWith(BUILDOPS_URL, "Strategic Initiatives");
  });
});
