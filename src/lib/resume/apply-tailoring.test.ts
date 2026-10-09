import { describe, expect, it } from "vitest";
import { applyTailoring } from "./apply-tailoring";
import { emptyTailoringPlan } from "./types";
import type { ResumeData } from "@/lib/db/schema";

const baseResume: ResumeData = {
  name: "Test Candidate",
  contactLine: "test@example.com",
  education: [{ school: "Test University", degree: "B.S. Testing" }],
  experience: [
    {
      company: "Acme Corp",
      role: "Analyst",
      dateRange: "2020 - 2022",
      bullets: [
        {
          id: "acme-1",
          text: "Did the first thing using vendors.",
          keywords: ["first"],
          synonyms: { vendors: ["vendors", "suppliers"] },
        },
        {
          id: "acme-2",
          text: "Did the second thing.",
          keywords: ["second"],
          synonyms: {},
        },
      ],
    },
  ],
  projects: [],
  skills: [
    { category: "Tools", items: ["Excel"] },
    { category: "Languages", items: ["Python"] },
  ],
  certifications: [],
};

describe("applyTailoring", () => {
  it("returns bullets/skills unchanged when the plan is empty", () => {
    const result = applyTailoring(baseResume, emptyTailoringPlan());
    expect(result.experience[0].bullets.map((b) => b.id)).toEqual(["acme-1", "acme-2"]);
    expect(result.skills.map((s) => s.category)).toEqual(["Tools", "Languages"]);
  });

  it("reorders bullets per the plan, appending any missing IDs", () => {
    const plan = emptyTailoringPlan();
    plan.bulletOrder["Acme Corp"] = ["acme-2"];
    const result = applyTailoring(baseResume, plan);
    expect(result.experience[0].bullets.map((b) => b.id)).toEqual(["acme-2", "acme-1"]);
  });

  it("ignores bullet IDs not present in the fixed inventory", () => {
    const plan = emptyTailoringPlan();
    plan.bulletOrder["Acme Corp"] = ["fabricated-id", "acme-2"];
    const result = applyTailoring(baseResume, plan);
    expect(result.experience[0].bullets.map((b) => b.id)).toEqual(["acme-2", "acme-1"]);
  });

  it("applies a phrase swap only when it is a pre-approved synonym", () => {
    const plan = emptyTailoringPlan();
    plan.phraseChoices["acme-1"] = { vendors: "suppliers" };
    const result = applyTailoring(baseResume, plan);
    expect(result.experience[0].bullets[0].text).toBe("Did the first thing using suppliers.");
  });

  it("never applies a phrase swap that is not in the synonym list (fabrication guard)", () => {
    const plan = emptyTailoringPlan();
    plan.phraseChoices["acme-1"] = { vendors: "invented replacement text" };
    const result = applyTailoring(baseResume, plan);
    expect(result.experience[0].bullets[0].text).toBe("Did the first thing using vendors.");
  });

  it("reorders skills per the plan, appending any missing categories", () => {
    const plan = emptyTailoringPlan();
    plan.skillsOrder = ["Languages"];
    const result = applyTailoring(baseResume, plan);
    expect(result.skills.map((s) => s.category)).toEqual(["Languages", "Tools"]);
  });
});

describe("applyTailoring — bullet rewrites", () => {
  const resume: ResumeData = {
    ...baseResume,
    experience: [
      {
        company: "Acme Corp",
        role: "Analyst",
        dateRange: "2020 - 2022",
        bullets: [
          {
            id: "acme-1",
            text: "Recovered $3M in SLA credits across 12 vendors by owning an outage analysis process.",
            keywords: ["SLA"],
            synonyms: { vendors: ["vendors", "suppliers"] },
          },
        ],
      },
    ],
  };
  const rewriteOnly = (text: string) => ({ ...emptyTailoringPlan(), bulletRewrites: { "acme-1": text } });
  const textOf = (r: ResumeData) => r.experience[0].bullets[0].text;

  it("applies a rewrite that preserves numbers and entities", () => {
    const good = "Drove recovery of $3M in SLA credits across 12 vendors by owning an outage remediation workflow.";
    expect(textOf(applyTailoring(resume, rewriteOnly(good)))).toBe(good);
  });

  it("discards a rewrite that invents a metric, keeping the original", () => {
    const bad = "Recovered $3M in SLA credits — up 40% — across 12 vendors by owning an outage analysis process.";
    expect(textOf(applyTailoring(resume, rewriteOnly(bad)))).toBe(resume.experience[0].bullets[0].text);
  });

  it("discards a rewrite that invents a tool", () => {
    const bad = "Recovered $3M in SLA credits across 12 vendors by owning a Datadog outage analysis process.";
    expect(textOf(applyTailoring(resume, rewriteOnly(bad)))).toBe(resume.experience[0].bullets[0].text);
  });

  it("discards a rewrite that changes a number's magnitude", () => {
    const bad = "Recovered $3B in SLA credits across 12 vendors by owning an outage analysis process.";
    expect(textOf(applyTailoring(resume, rewriteOnly(bad)))).toBe(resume.experience[0].bullets[0].text);
  });

  it("prefers a valid rewrite over synonym swaps for the same bullet", () => {
    const good = "Drove recovery of $3M in SLA credits across 12 vendors by owning an outage remediation workflow.";
    const plan = { ...rewriteOnly(good), phraseChoices: { "acme-1": { vendors: "suppliers" } } };
    expect(textOf(applyTailoring(resume, plan))).toBe(good);
  });

  it("falls back to synonym swaps when the rewrite is rejected", () => {
    const bad = "Recovered $99M in SLA credits across 12 vendors by owning an outage analysis process.";
    const plan = { ...rewriteOnly(bad), phraseChoices: { "acme-1": { vendors: "suppliers" } } };
    expect(textOf(applyTailoring(resume, plan))).toContain("suppliers");
  });
});
