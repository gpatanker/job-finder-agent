import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverFromKnownCompanyBoards } from "./known-company-boards";

describe("discoverFromKnownCompanyBoards", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("polls each distinct known Greenhouse/Ashby board and returns role-matching, non-senior postings as candidates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("boards-api.greenhouse.io")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              jobs: [
                {
                  title: "Strategy & Operations Manager",
                  absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1",
                },
                {
                  title: "Software Engineer",
                  absolute_url: "https://job-boards.greenhouse.io/acme/jobs/2",
                },
                {
                  title: "Director, Strategy & Operations",
                  absolute_url: "https://job-boards.greenhouse.io/acme/jobs/3",
                },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: false, status: 500 });
      })
    );

    const candidates = await discoverFromKnownCompanyBoards({
      known: [
        { company: "Acme", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/999" },
        // Same board reached via a second known posting — should collapse to one fetch.
        { company: "Acme", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/998" },
      ],
      roleFamilies: ["Business Operations Manager"],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      company: "Acme",
      title: "Strategy & Operations Manager",
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
      sourceUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
    });
    expect(candidates[0].matchScore).toBeGreaterThan(0);
  });

  it("excludes over-senior titles (Director/Head of/VP) even if the title otherwise matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jobs: [
            {
              title: "Head of Business Operations",
              absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1",
            },
          ],
        }),
      })
    );

    const candidates = await discoverFromKnownCompanyBoards({
      known: [{ company: "Acme", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/999" }],
      roleFamilies: ["Business Operations Manager"],
    });

    expect(candidates).toEqual([]);
  });

  it("ignores known entries with no apply URL or an unrecognized ATS", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await discoverFromKnownCompanyBoards({
      known: [
        { company: "NoUrl", applyUrl: null },
        { company: "CustomSite", applyUrl: "https://custom-company.com/careers/role-123" },
      ],
      roleFamilies: ["Business Operations Manager"],
    });

    expect(candidates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips a company whose live board fetch fails (fails open, no candidates from that board)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const candidates = await discoverFromKnownCompanyBoards({
      known: [{ company: "Acme", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/999" }],
      roleFamilies: ["Business Operations Manager"],
    });

    expect(candidates).toEqual([]);
  });
});
