import { describe, expect, it, vi } from "vitest";
import { fitPlanToOnePage, countPdfPages } from "./fit-one-page";
import { emptyTailoringPlan } from "./types";
import type { ResumeData } from "@/lib/db/schema";

const resume: ResumeData = {
  name: "Test Candidate",
  contactLine: "test@example.com",
  education: [{ school: "Test University", degree: "B.S. Testing" }],
  experience: [
    {
      company: "Acme Corp",
      role: "Analyst",
      dateRange: "2020 - 2022",
      bullets: [
        { id: "a1", text: "Recovered $3M in SLA credits across 12 vendors.", keywords: [], synonyms: {} },
        { id: "a2", text: "Cut costs by 10%.", keywords: [], synonyms: {} },
      ],
    },
  ],
  skills: [{ category: "Tools", items: ["Python"] }],
  certifications: [],
  projects: [],
};

/** Stand-in renderer: one page while total bullet text is under `budget`. */
function renderer(budget: number) {
  return vi.fn(async (data: ResumeData) => {
    const chars = data.experience.flatMap((e) => e.bullets).reduce((n, b) => n + b.text.length, 0);
    const pages = chars > budget ? 2 : 1;
    return Buffer.from("/Type /Page \n".repeat(pages));
  });
}

describe("countPdfPages", () => {
  it("counts page objects without counting the /Pages tree node", () => {
    expect(countPdfPages(Buffer.from("/Type /Pages\n/Type /Page \n/Type /Page \n"))).toBe(2);
  });
});

describe("fitPlanToOnePage", () => {
  const baseLen = resume.experience[0].bullets.reduce((n, b) => n + b.text.length, 0);

  it("leaves the plan untouched when it already fits", async () => {
    const plan = { ...emptyTailoringPlan(), bulletRewrites: { a2: "Reduced costs by 10%." } };
    const res = await fitPlanToOnePage(resume, plan, renderer(baseLen + 100));
    expect(res.pages).toBe(1);
    expect(res.droppedRewrites).toEqual([]);
    expect(res.plan.bulletRewrites).toEqual({ a2: "Reduced costs by 10%." });
  });

  it("drops the biggest length-adding rewrite first", async () => {
    const plan = {
      ...emptyTailoringPlan(),
      // Both rewrites must PASS validateRewrite, or applyTailoring discards them
      // and there is nothing for the fitter to give back.
      bulletRewrites: {
        a1: "Recovered $3M in SLA credits from across 12 external vendor partners.", // +22 chars
        a2: "Reduced costs by 10%.", // +4 chars
      },
    };
    const res = await fitPlanToOnePage(resume, plan, renderer(baseLen + 20));
    expect(res.pages).toBe(1);
    expect(res.droppedRewrites).toEqual(["a1"]);
    expect(res.plan.bulletRewrites).toHaveProperty("a2"); // the small one survives
  });

  it("keeps dropping until it fits", async () => {
    const plan = {
      ...emptyTailoringPlan(),
      bulletRewrites: {
        a1: "Recovered $3M in SLA credits from across 12 external vendor partners.",
        a2: "Reduced costs by 10%.",
      },
    };
    const res = await fitPlanToOnePage(resume, plan, renderer(baseLen));
    expect(res.pages).toBe(1);
    expect(res.droppedRewrites).toHaveLength(2);
    expect(res.plan.bulletRewrites).toEqual({});
  });

  it("sacrifices a length-adding rewrite before a length-neutral one", async () => {
    const plan = {
      ...emptyTailoringPlan(),
      bulletRewrites: {
        a1: "Recovered $3M in SLA credits from across 12 external vendor partners.", // +22
        a2: "Cut costs by 10%!", // same length
      },
    };
    const res = await fitPlanToOnePage(resume, plan, renderer(baseLen + 5));
    expect(res.droppedRewrites).toEqual(["a1"]);
    expect(res.plan.bulletRewrites).toHaveProperty("a2");
  });

  it("reports when the master resume itself overflows", async () => {
    const res = await fitPlanToOnePage(resume, emptyTailoringPlan(), renderer(0));
    expect(res.overflowsWithoutRewrites).toBe(true);
    expect(res.droppedRewrites).toEqual([]);
  });
});

describe("fitPlanToOnePage — which rewrite gets sacrificed", () => {
  const twoJobs: ResumeData = {
    ...resume,
    experience: [
      {
        company: "Current Co",
        role: "Analyst",
        dateRange: "2024 - Present",
        bullets: [{ id: "cur-1", text: "Recovered $3M in SLA credits across 12 vendors.", keywords: [], synonyms: {} }],
      },
      {
        company: "Older Co",
        role: "Analyst",
        dateRange: "2020 - 2022",
        bullets: [{ id: "old-1", text: "Cut costs by 10%.", keywords: [], synonyms: {} }],
      },
    ],
  };

  it("gives up the older role's rewrite before the current role's, even when the current one is longer", async () => {
    const base = 47 + 17;
    const plan = {
      ...emptyTailoringPlan(),
      bulletRewrites: {
        "cur-1": "Recovered $3M in SLA credits from across 12 external vendor partners.", // +22, current role
        "old-1": "Reduced costs by 10%.", // +4, older role
      },
    };
    const res = await fitPlanToOnePage(twoJobs, plan, renderer(base + 25));
    expect(res.pages).toBe(1);
    expect(res.droppedRewrites).toEqual(["old-1"]);
    expect(res.plan.bulletRewrites).toHaveProperty("cur-1");
  });
});

describe("fitPlanToOnePage — rewrites that don't add characters", () => {
  it("still gives back equal-length rewrites when the page overflows", async () => {
    // A same-length rewrite can wrap differently and cost a line, so the fitter
    // must not stop just because nothing grew in character count.
    const plan = { ...emptyTailoringPlan(), bulletRewrites: { a2: "Cut costs by 10%!" } }; // same length
    const alwaysTwoPages = vi.fn(async () => Buffer.from("/Type /Page \n/Type /Page \n"));
    const res = await fitPlanToOnePage(resume, plan, alwaysTwoPages);
    expect(res.droppedRewrites).toEqual(["a2"]);
    expect(res.plan.bulletRewrites).toEqual({});
    expect(res.overflowsWithoutRewrites).toBe(true);
  });

  it("does not blame the master while rewrites remain to give back", async () => {
    const plan = { ...emptyTailoringPlan(), bulletRewrites: { a2: "Reduced costs by 10%." } };
    let call = 0;
    // Overflows on the first render, fits once the rewrite is dropped.
    const render = vi.fn(async () => Buffer.from("/Type /Page \n".repeat(++call === 1 ? 2 : 1)));
    const res = await fitPlanToOnePage(resume, plan, render);
    expect(res.pages).toBe(1);
    expect(res.overflowsWithoutRewrites).toBe(false);
  });
});

describe("fitPlanToOnePage — synonym swaps also add length", () => {
  it("gives back synonym swaps once rewrites are exhausted, instead of blaming the master", async () => {
    // Regression: a real run dropped every rewrite, still rendered 2 pages because
    // swaps like "Negotiated" -> "Drove procurement negotiations for" had grown the
    // text, and reported the master as too long for one page. It wasn't.
    const withSyn: ResumeData = {
      ...resume,
      experience: [
        {
          company: "Acme Corp",
          role: "Analyst",
          dateRange: "2020 - 2022",
          bullets: [
            {
              id: "a1",
              text: "Negotiated a 10% reduction with vendors.",
              keywords: [],
              synonyms: { Negotiated: ["Negotiated", "Drove procurement negotiations for"] },
            },
          ],
        },
      ],
    };
    const plan = {
      ...emptyTailoringPlan(),
      phraseChoices: { a1: { Negotiated: "Drove procurement negotiations for" } },
    };
    const base = withSyn.experience[0].bullets[0].text.length;
    const res = await fitPlanToOnePage(withSyn, plan, renderer(base + 5));
    expect(res.pages).toBe(1);
    expect(res.droppedSwaps).toEqual(["a1"]);
    expect(res.overflowsWithoutRewrites).toBe(false);
  });

  it("only blames the master once rewrites AND swaps are both gone", async () => {
    const alwaysTwo = vi.fn(async () => Buffer.from("/Type /Page \n/Type /Page \n"));
    const res = await fitPlanToOnePage(resume, emptyTailoringPlan(), alwaysTwo);
    expect(res.overflowsWithoutRewrites).toBe(true);
  });
});

describe("fitPlanToOnePage — what gets sacrificed first", () => {
  it("gives back a synonym swap before a keyword-bearing rewrite", async () => {
    // Rewrites carry the posting's vocabulary (what an ATS scores); swaps are just
    // alternate phrasings. Sacrificing rewrites first stripped every keyword while
    // leaving the longer swaps that were causing the overflow.
    const withSyn: ResumeData = {
      ...resume,
      experience: [
        {
          company: "Acme Corp",
          role: "Analyst",
          dateRange: "2020 - 2022",
          bullets: [
            {
              id: "a1",
              text: "Negotiated a 10% reduction with vendors.",
              keywords: [],
              synonyms: { Negotiated: ["Negotiated", "Drove procurement negotiations for"] },
            },
            { id: "a2", text: "Cut costs by 10%.", keywords: [], synonyms: {} },
          ],
        },
      ],
    };
    const plan = {
      ...emptyTailoringPlan(),
      phraseChoices: { a1: { Negotiated: "Drove procurement negotiations for" } },
      bulletRewrites: { a2: "Reduced spend by 10%." },
    };
    const base = withSyn.experience[0].bullets.reduce((n, b) => n + b.text.length, 0);
    const res = await fitPlanToOnePage(withSyn, plan, renderer(base + 6));
    expect(res.pages).toBe(1);
    expect(res.droppedSwaps).toEqual(["a1"]);
    expect(res.plan.bulletRewrites).toHaveProperty("a2"); // the keyword-bearing rewrite survives
  });
});
