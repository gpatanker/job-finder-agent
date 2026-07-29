import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyRoleFamily,
  discoverFromKnownCompanyBoards,
  isLikelyNonUsLocation,
  scoreLiveBoardMatch,
  titleMatchesTargetRoleFamily,
} from "./known-company-boards";

/** The candidate's real stated role families, as seeded in candidate_profile. */
const ROLE_FAMILIES = [
  "Business Operations",
  "Strategy & Operations",
  "GTM Operations",
  "Infrastructure Operations",
  "BizOps",
  "RevOps",
  "Business Operations Manager",
  "Senior Business Operations Manager",
  "Strategy Associate/Manager",
  "Operations Analyst/Manager",
  "AI Infrastructure Operations",
];

describe("classifyRoleFamily", () => {
  it(
    "regression: rejects every off-domain title the first version of this channel surfaced " +
      "(2026-07-27 — 58 board-poll suggestions, all scored a flat 55, with these among them)",
    () => {
      const realFalsePositives = [
        "Recruiting Operations and Programs Manager", // Ripple
        "Recruiting Operations Manager", // PermitFlow, Harvey
        "Warehouse Operations Manager", // Coram AI
        "HR & People Operations Manager", // OpenFX
        "People Strategy & Operations, Early Career", // Notion
        "Operations Manager - Guadalajara", // Overview Corporation
        "ソリューションアーキテクト (プリセールス)", // Databricks — "Solution Architect (Pre-sales)"
        "Content Operations Manager", // Adyen
        "Billing Operations Manager", // ElevenLabs
        "Treasury Operations Manager (Francophone Africa)", // Taptap Send
        "Hardware Operations Manager", // Hinge Health
        "Lifecycle Operations Manager", // Ōura
        "Data Operations Manager, Human Data", // Anthropic
        "Supply Chain Operations Program Manager, AI Infrastructure", // OpenAI
        "Senior Manager, Payroll Compliance & International Operations", // Figma
        "Senior Operations Manager, Field Finance", // Snowflake
        "Senior Business Systems Manager", // Zip
        "Senior Manager, Business Process Controls", // Fluidstack
        "Senior Product Manager - Business Lending", // Mercury
        "Business Development Senior Manager", // Ripple
        "Associate Manager, Consumer Promotions Strategy", // DoorDash
      ];
      for (const title of realFalsePositives) {
        expect(classifyRoleFamily(title), title).toBeNull();
      }
    }
  );

  it("still matches genuinely on-target titles", () => {
    const shouldMatch: [string, ReturnType<typeof classifyRoleFamily>][] = [
      ["Strategy & Operations Manager", "strategy-ops"],
      ["Senior GTM Strategy & Operations Manager", "core"],
      ["Business Operations Manager AI infrastructure", "core"],
      ["Manager, Business Operations", "core"],
      ["Revenue Operations Manager", "core"],
      ["Founding RevOps", "core"],
      ["Founding Biz Ops Lead", "core"],
      ["GTM Strategy & Operations", "core"],
      ["Business Operations Analyst (Starlink)", "core"],
      ["Compute Strategy & Operations Lead", "strategy-ops"],
      ["Pricing Strategy & Operations", "strategy-ops"],
      ["Sales Operations Manager, New Business", "core"],
      ["Product Operations Manager", "adjacent"],
      ["Technical Operations Manager", "adjacent"],
    ];
    for (const [title, tier] of shouldMatch) {
      expect(classifyRoleFamily(title), title).toBe(tier);
    }
  });

  it(
    "finance and marketing are hard exclusions (2026-07-28), even paired with a core domain " +
      "word — the candidate confirmed neither aligns with what he does, regardless of also " +
      "naming Business Operations/Strategy/GTM in the same title",
    () => {
      const excluded = [
        "Strategic Finance - Business Operations Lead", // Snowflake — actually applied to before this rule existed
        "Manager, Strategic Finance & Business Operations", // Verkada — same
        "FP&A Manager, Business Operations",
        "Finance Operations Analyst",
        "Sr. Manager, Growth Marketing Operations", // Pendo — actually applied to before this rule existed
        "Marketing Strategy & Operations Manager",
      ];
      for (const title of excluded) {
        expect(classifyRoleFamily(title), title).toBeNull();
      }
    }
  );

  it(
    "corporate development / M&A is a hard exclusion (2026-07-28) despite 'corporate' being a " +
      "core domain word and these titles usually also naming 'operation(s)'",
    () => {
      const excluded = [
        "Corporate Development Operation & M&A Integration Lead", // Snowflake — scored 82 before this rule
        "Product Strategy and Corporate Development Lead, AI", // Datadog
        "Manager, M&A Integration & Business Operations",
        "Mergers and Acquisitions Operations Lead",
      ];
      for (const title of excluded) {
        expect(classifyRoleFamily(title), title).toBeNull();
      }
    }
  );

  it(
    "quota-carrying / customer-facing sales IC titles are excluded (2026-07-28) even when " +
      "'Strategic' pairs with a core domain word like 'Commercial' — Sales/Revenue/Partner " +
      "*Operations* is a different thing and stays in scope",
    () => {
      const excluded = [
        "Strategic Account Executive, Retail & Commercial Banking - FSI", // Anthropic
        "Manager, Account Executive - Strategic Sales", // Anthropic
        "Strategic Account Executive, New Vertical Sales", // Flex
        "Sales Manager, Strategic Accounts", // Ripple
        "Strategic Sales Development Representative, Robotics & Automotive", // Scale AI
        "Business Development Representative, Enterprise",
        "Commercial Account Manager, Strategic Operations",
        "SDR Manager, Business Operations",
      ];
      for (const title of excluded) {
        expect(classifyRoleFamily(title), title).toBeNull();
      }
      // The ops function behind the sales org is still the candidate's job.
      expect(classifyRoleFamily("Sales Operations Manager - Enterprise")).toBe("adjacent");
      expect(classifyRoleFamily("Revenue Operations Manager")).toBe("core");
      expect(classifyRoleFamily("Partner Operations Lead")).toBe("adjacent");
    }
  );

  it(
    "hands-on engineering / technical IC titles are excluded (2026-07-28) — an '...Engineer' " +
      "title routinely also names Operations plus an adjacent domain, so the structural test " +
      "alone let them through",
    () => {
      const excluded = [
        "Sales Systems Engineer, Enterprise Operations", // Perplexity
        "Global Operations Engineer (Product & Change Management)", // SpaceX
        "Infrastructure Engineer (Data Center Operations)", // Cerebras
        "Quality Engineer - Rack Infrastructure & Site Operations - Stargate", // OpenAI
        "AI Field Engineer - Strategic Partnerships", // Fireworks AI
        "Data Center Operations Systems Engineer (Kansas City, MO)", // Lambda
        "Data Center Operations System Engineer III (Chicago)", // Lambda
        "Infrastructure Ops Engineer", // Baseten
        "Network Operator, Data Center Operations", // Fluidstack — "network operations" didn't catch the singular
      ];
      for (const title of excluded) {
        expect(classifyRoleFamily(title), title).toBeNull();
      }
      // Same domains, non-engineer titles — these are the candidate's own
      // stated role families and must survive the exclusion above. This is
      // deliberately "engineer(s)", not the broader "engineering" — a title
      // like "Engineering Operations Manager" is a BizOps-for-the-
      // engineering-org role, not a hands-on IC engineer title, and isn't
      // evidenced as unwanted (2026-07-28: narrowed from an initial
      // "engineering"-wide exclusion after review).
      expect(classifyRoleFamily("Senior Technical Program Manager – AI Infrastructure, Site Operations")).toBe(
        "adjacent"
      );
      expect(classifyRoleFamily("AI Infrastructure Operations Manager")).toBe("adjacent");
      expect(classifyRoleFamily("Business Operations Manager, Data Center Strategy")).toBe("core");
      expect(classifyRoleFamily("Engineering Operations Manager, Business Systems")).toBe("core");
    }
  );

  it(
    "root cause 1: a bare, unqualified 'Operations Manager' no longer matches — the old " +
      "phrase pool contained the 2-word synonym 'Operations Manager', which textMentionsTitle's " +
      "exact-substring fast path found inside ANY '<something> Operations Manager'",
    () => {
      expect(titleMatchesTargetRoleFamily("Operations Manager")).toBe(false);
      expect(titleMatchesTargetRoleFamily("Senior Operations Manager")).toBe(false);
      // The blank has to be filled with one of the candidate's actual domains.
      expect(titleMatchesTargetRoleFamily("Business Operations Manager")).toBe(true);
      expect(titleMatchesTargetRoleFamily("Revenue Operations Manager")).toBe(true);
    }
  );

  it(
    "root cause 2: the 70%-word-overlap fallback used to count the stopword 'and', so " +
      "'Recruiting Operations and Programs Manager' hit 3/4 words of 'Strategy and Operations Manager'",
    () => {
      expect(titleMatchesTargetRoleFamily("Recruiting Operations and Programs Manager")).toBe(false);
      expect(titleMatchesTargetRoleFamily("Facilities Operations and Programs Manager")).toBe(false);
    }
  );

  it(
    "root cause 3: a title with no Latin characters is uncomparable, not a wildcard match " +
      "(it used to normalize to '' and hit textMentionsTitle's trivially-true early return)",
    () => {
      expect(titleMatchesTargetRoleFamily("ソリューションアーキテクト (プリセールス)")).toBe(false);
      expect(titleMatchesTargetRoleFamily("运营经理")).toBe(false);
      expect(titleMatchesTargetRoleFamily("— / —")).toBe(false);
      expect(titleMatchesTargetRoleFamily("")).toBe(false);
    }
  );

  it("requires an operations/strategy function at all, not just a matching domain word", () => {
    expect(titleMatchesTargetRoleFamily("Senior Software Engineer, Business Platform")).toBe(false);
    expect(titleMatchesTargetRoleFamily("Business Development Representative")).toBe(false);
    expect(titleMatchesTargetRoleFamily("Product Manager, Revenue")).toBe(false);
  });

  it(
    "supply-chain/logistics/support titles are only allowed through when clearly framed as a " +
      "business/strategy role, per the candidate's brief",
    () => {
      expect(titleMatchesTargetRoleFamily("Supply Chain Operations Manager")).toBe(false);
      expect(titleMatchesTargetRoleFamily("Logistics Operations Manager")).toBe(false);
      expect(titleMatchesTargetRoleFamily("Support Operations Manager")).toBe(false);
      expect(titleMatchesTargetRoleFamily("Strategy and Operations Associate, Supply Quality")).toBe(true);
      expect(titleMatchesTargetRoleFamily("Strategy & Operations Programs, Support")).toBe(true);
    }
  );

  it("an unenumerated specialization fails for lack of a qualifying domain, not by exclusion", () => {
    expect(titleMatchesTargetRoleFamily("Kitchen Operations Manager")).toBe(false);
    expect(titleMatchesTargetRoleFamily("Ticketing Operations Manager")).toBe(false);
    expect(titleMatchesTargetRoleFamily("Wardrobe Operations Manager")).toBe(false);
  });
});

describe("isLikelyNonUsLocation", () => {
  it("rejects a confidently non-US place named in a location or a title", () => {
    expect(isLikelyNonUsLocation("Guadalajara, Mexico")).toBe(true);
    expect(isLikelyNonUsLocation("Operations Manager - Guadalajara")).toBe(true);
    expect(isLikelyNonUsLocation("Partner Operations Manager, Latin America")).toBe(true);
    expect(isLikelyNonUsLocation("Sydney, Australia")).toBe(true);
    expect(isLikelyNonUsLocation("Bengaluru")).toBe(true);
  });

  it("fails open on US, ambiguous, and unlabeled locations", () => {
    expect(isLikelyNonUsLocation("San Francisco, CA")).toBe(false);
    expect(isLikelyNonUsLocation("Remote - US")).toBe(false);
    expect(isLikelyNonUsLocation("GTM Strategy and Operations Analyst - Boston")).toBe(false);
    expect(isLikelyNonUsLocation("Remote")).toBe(false);
    expect(isLikelyNonUsLocation(undefined)).toBe(false);
    expect(isLikelyNonUsLocation("")).toBe(false);
    // A US city that shares a name with a non-US one still wins, because a
    // named US state suppresses the non-US marker.
    expect(isLikelyNonUsLocation("Vancouver, WA")).toBe(false);
  });
});

describe("scoreLiveBoardMatch", () => {
  it(
    "regression: differentiates title quality instead of returning a flat 55 for everything " +
      "(the old heuristic's two bonuses required 'strategy'+'operations' together or a title " +
      "exactly string-equal to a role family, so 58 real suggestions all scored 55)",
    () => {
      const scores = [
        "Senior GTM Strategy & Operations Manager",
        "Business Operations Manager",
        "Revenue Operations Manager",
        "Product Operations Manager",
        "Business Operations Associate",
      ].map((t) => scoreLiveBoardMatch(t, ROLE_FAMILIES));
      expect(new Set(scores).size).toBe(scores.length);
    }
  );

  it("ranks a core BizOps/GTM-Ops manager title above an adjacent specialization above a junior one", () => {
    const seniorCore = scoreLiveBoardMatch("Senior GTM Strategy & Operations Manager", ROLE_FAMILIES);
    const core = scoreLiveBoardMatch("Business Operations Manager", ROLE_FAMILIES);
    const adjacent = scoreLiveBoardMatch("Product Operations Manager", ROLE_FAMILIES);
    const junior = scoreLiveBoardMatch("Business Operations Associate", ROLE_FAMILIES);
    expect(seniorCore).toBeGreaterThan(core);
    expect(core).toBeGreaterThan(adjacent);
    expect(adjacent).toBeGreaterThan(junior);
  });

  it("stays within a defensible band for a title-only signal, and returns 0 for a non-match", () => {
    for (const title of ["Senior GTM Strategy & Operations Manager", "Product Operations Coordinator"]) {
      const score = scoreLiveBoardMatch(title, ROLE_FAMILIES);
      expect(score).toBeGreaterThanOrEqual(40);
      expect(score).toBeLessThanOrEqual(88);
    }
    expect(scoreLiveBoardMatch("Recruiting Operations Manager", ROLE_FAMILIES)).toBe(0);
  });

  it("gives credit for a confirmed US location", () => {
    expect(scoreLiveBoardMatch("Business Operations Manager", ROLE_FAMILIES, "San Francisco, CA")).toBeGreaterThan(
      scoreLiveBoardMatch("Business Operations Manager", ROLE_FAMILIES)
    );
  });
});

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
                  location: { name: "San Francisco, CA" },
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
      location: "San Francisco, CA",
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
      sourceUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
    });
    expect(candidates[0].matchScore).toBeGreaterThan(0);
    expect(candidates[0].rationale).toContain("Strategy & Operations match");
  });

  it("excludes over-senior titles (Director/Head of/VP/Principal) even if the title otherwise matches", async () => {
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
            {
              // Fluidstack, 2026-07-28 — classifies as a real ops family
              // ("operations" + "data center"), so only the shared
              // isOverSeniorTitle backstop keeps it out.
              title: "Principal Electrical Operations Lead — Data Center Operations",
              absolute_url: "https://job-boards.greenhouse.io/acme/jobs/2",
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

  it(
    "regression: filters the real off-domain and non-Latin garbage a single live board can " +
      "contain, keeping only the genuinely on-target posting",
    async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            jobs: [
              { title: "Recruiting Operations Manager", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1" },
              { title: "Warehouse Operations Manager", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/2" },
              { title: "HR & People Operations Manager", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/3" },
              { title: "ソリューションアーキテクト (プリセールス)", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/4" },
              {
                title: "Operations Manager",
                absolute_url: "https://job-boards.greenhouse.io/acme/jobs/5",
                location: { name: "Guadalajara, Mexico" },
              },
              {
                title: "Senior GTM Strategy & Operations Manager",
                absolute_url: "https://job-boards.greenhouse.io/acme/jobs/6",
                location: { name: "Remote - US" },
              },
            ],
          }),
        })
      );

      const candidates = await discoverFromKnownCompanyBoards({
        known: [{ company: "Acme", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/999" }],
        roleFamilies: ["Business Operations", "GTM Operations", "RevOps"],
      });

      expect(candidates.map((c) => c.title)).toEqual(["Senior GTM Strategy & Operations Manager"]);
    }
  );

  it("drops an on-target title whose live-board location is clearly outside the US", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jobs: [
            {
              title: "Business Operations Manager",
              absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1",
              location: { name: "London, United Kingdom" },
            },
          ],
        }),
      })
    );

    const candidates = await discoverFromKnownCompanyBoards({
      known: [{ company: "Acme", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/999" }],
      roleFamilies: ["Business Operations"],
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
