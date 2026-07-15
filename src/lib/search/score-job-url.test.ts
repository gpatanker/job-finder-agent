import { afterEach, describe, expect, it, vi } from "vitest";
import type { CandidateProfile, ResumeData } from "@/lib/db/schema";

const profile = {
  id: "profile-1",
  name: "Jordan Example",
  email: "jordan@example.com",
  phone: null,
  linkedin: null,
  location: "Austin, TX",
  currentCompany: "Example Corp",
  functionTags: [],
  preferredIndustries: [],
  workAuthorized: true,
  requiresSponsorship: false,
  genderIdentity: null,
  raceEthnicity: null,
  sexualOrientation: null,
  veteranStatus: null,
  disabilityStatus: null,
  zipCode: null,
  highestEducationLevel: null,
  totalYearsExperience: null,
  requiresRelocationAssistance: false,
  howHeardDefault: null,
  aiPolicyAgreement: null,
  education: [],
  searchCriteria: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies CandidateProfile;

const resume: ResumeData = {
  name: "Jordan Example",
  contactLine: "jordan@example.com",
  education: [],
  experience: [
    {
      company: "Example Corp",
      role: "Business Operations Analyst",
      dateRange: "Jan 2022 – Present",
      bullets: [{ id: "b1", text: "Built a reporting pipeline.", keywords: [], synonyms: {} }],
    },
  ],
  projects: [],
  skills: [{ category: "Tools", items: ["SQL", "Python"] }],
  certifications: [],
};

function toolResponse(input: Record<string, unknown>) {
  return {
    content: [{ type: "tool_use", id: "toolu_1", name: "submit_job_score", input }],
  };
}

describe("scoreJobUrl", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("rejects a blocked source (e.g. TheLadders) without fetching or calling the API", async () => {
    const { scoreJobUrl } = await import("./score-job-url");
    const result = await scoreJobUrl({
      url: "https://www.theladders.com/job/some-role",
      profile,
      resume,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("payment");
  });

  it("rejects a generic careers-page URL without fetching or calling the API", async () => {
    const { scoreJobUrl } = await import("./score-job-url");
    const result = await scoreJobUrl({
      url: "https://acme.com/careers",
      profile,
      resume,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("specific posting");
  });

  it("rejects a posting whose page text indicates it's closed, before calling the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "<body>This position is no longer accepting applications.</body>",
      })
    );
    const { scoreJobUrl } = await import("./score-job-url");
    const result = await scoreJobUrl({
      url: "https://acme.com/careers/senior-analyst-4821",
      profile,
      resume,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("closed");
  });

  it(
    "regression: extracts and scores a real posting, clamping an out-of-range score and " +
      "rejecting if the extracted title doesn't actually appear on the page",
    async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          "<html><body><h1>Senior Business Operations Analyst</h1><p>Acme Corp is hiring.</p></body></html>",
      });
      vi.stubGlobal("fetch", fetchMock);

      const create = vi.fn().mockResolvedValue(
        toolResponse({
          company: "Acme Corp",
          title: "Senior Business Operations Analyst",
          location: "Remote",
          matchScore: 150, // deliberately out of range
          rationale: "Strong overlap with your reporting-pipeline experience.",
        })
      );
      vi.doMock("@anthropic-ai/sdk", () => ({
        default: class {
          messages = { create };
        },
      }));

      const { scoreJobUrl } = await import("./score-job-url");
      const result = await scoreJobUrl({
        url: "https://acme.com/careers/senior-analyst-4821",
        profile,
        resume,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.company).toBe("Acme Corp");
        expect(result.result.matchScore).toBe(100); // clamped
      }
    }
  );

  it(
    'regression: treats a literal "<UNKNOWN>" placeholder (something Claude occasionally fills ' +
      "in for an optional field instead of actually omitting it) the same as genuinely absent",
    async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () =>
            "<html><body><h1>Senior Business Operations Analyst</h1><p>Acme Corp is hiring.</p></body></html>",
        })
      );
      const create = vi.fn().mockResolvedValue(
        toolResponse({
          company: "Acme Corp",
          title: "Senior Business Operations Analyst",
          location: "<UNKNOWN>",
          workMode: "N/A",
          matchScore: 60,
          rationale: "Some rationale.",
        })
      );
      vi.doMock("@anthropic-ai/sdk", () => ({
        default: class {
          messages = { create };
        },
      }));

      const { scoreJobUrl } = await import("./score-job-url");
      const result = await scoreJobUrl({
        url: "https://acme.com/careers/senior-analyst-4821",
        profile,
        resume,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.location).toBeNull();
        expect(result.result.workMode).toBeNull();
      }
    }
  );

  it(
    "regression: extracts from the meta description tag when the page body is empty " +
      "(real case: Ashby ships a client-rendered SPA shell with an empty <body> in the raw " +
      "HTML, but puts the full job description in <meta name=\"description\"> for SEO)",
    async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () =>
            `<html><head><title>Analyst, Revenue Strategy &amp; Operations @ Baseten</title>` +
            `<meta name="description" content="Baseten is hiring an Analyst, Revenue Strategy and Operations."></head>` +
            `<body><div id="root"></div></body></html>`,
        })
      );

      const create = vi.fn().mockResolvedValue(
        toolResponse({
          company: "Baseten",
          title: "Analyst, Revenue Strategy & Operations",
          matchScore: 70,
          rationale: "Good overlap with revenue operations experience.",
        })
      );
      vi.doMock("@anthropic-ai/sdk", () => ({
        default: class {
          messages = { create };
        },
      }));

      const { scoreJobUrl } = await import("./score-job-url");
      const result = await scoreJobUrl({
        url: "https://jobs.ashbyhq.com/baseten/6d32aa11-ac93-4f90-8f62-bdeb79214ee5",
        profile,
        resume,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.company).toBe("Baseten");
      }
    }
  );

  it("rejects the result if the extracted title doesn't actually appear on the fetched page (guards against a hallucinated/mismatched extraction)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "<html><body><h1>Completely Different Role</h1></body></html>",
      })
    );
    const create = vi.fn().mockResolvedValue(
      toolResponse({
        company: "Acme Corp",
        title: "Senior Business Operations Analyst",
        matchScore: 80,
        rationale: "Some rationale.",
      })
    );
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create };
      },
    }));

    const { scoreJobUrl } = await import("./score-job-url");
    const result = await scoreJobUrl({
      url: "https://acme.com/careers/senior-analyst-4821",
      profile,
      resume,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Couldn't confirm");
  });
});
