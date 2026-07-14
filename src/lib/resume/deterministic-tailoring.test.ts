import { describe, expect, it } from "vitest";
import { deterministicTailoringPlan } from "./deterministic-tailoring";
import type { ResumeData } from "@/lib/db/schema";

const resume: ResumeData = {
  name: "Test",
  contactLine: "test@example.com",
  education: [],
  experience: [
    {
      company: "Acme",
      role: "Analyst",
      dateRange: "2020",
      bullets: [
        { id: "a1", text: "Built dashboards in Tableau for sales teams.", keywords: [], synonyms: {} },
        { id: "a2", text: "Negotiated vendor contracts for GPU procurement.", keywords: [], synonyms: {} },
      ],
    },
  ],
  projects: [],
  skills: [
    { category: "BI", items: ["Tableau", "Excel"] },
    { category: "Cloud", items: ["AWS", "GPU infrastructure"] },
  ],
  certifications: [],
};

describe("deterministicTailoringPlan", () => {
  it("ranks bullets by keyword overlap with the job description", () => {
    const plan = deterministicTailoringPlan(
      resume,
      "Looking for someone with GPU procurement and vendor negotiation experience."
    );
    expect(plan.bulletOrder["Acme"][0]).toBe("a2");
  });

  it("ranks skill categories by keyword overlap", () => {
    const plan = deterministicTailoringPlan(resume, "GPU infrastructure and cloud experience required.");
    expect(plan.skillsOrder[0]).toBe("Cloud");
  });

  it("never sets phraseChoices (deterministic mode only reorders)", () => {
    const plan = deterministicTailoringPlan(resume, "GPU vendor negotiation");
    expect(Object.keys(plan.phraseChoices)).toHaveLength(0);
  });

  it("returns an empty plan when the job description has no extractable keywords", () => {
    const plan = deterministicTailoringPlan(resume, "");
    expect(plan.bulletOrder).toEqual({});
    expect(plan.skillsOrder).toEqual([]);
  });
});
