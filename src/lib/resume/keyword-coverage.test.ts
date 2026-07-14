import { describe, expect, it } from "vitest";
import { scoreCoverage, missingKeywords } from "./keyword-coverage";
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
        { id: "a1", text: "Negotiated vendor contracts for GPU procurement.", keywords: [], synonyms: {} },
      ],
    },
  ],
  projects: [],
  skills: [{ category: "Cloud", items: ["Python", "SQL"] }],
  certifications: [],
};

describe("scoreCoverage", () => {
  it("returns 100 when the job description has no extractable keywords", () => {
    expect(scoreCoverage(resume, "")).toBe(100);
  });

  it("scores higher when more job-description keywords appear in the resume", () => {
    const highScore = scoreCoverage(resume, "vendor procurement GPU Python SQL");
    const lowScore = scoreCoverage(resume, "javascript frontend design figma marketing");
    expect(highScore).toBeGreaterThan(lowScore);
  });
});

describe("missingKeywords", () => {
  it("lists job-description keywords not present anywhere in the resume", () => {
    const missing = missingKeywords(resume, "vendor procurement kubernetes terraform");
    expect(missing).toContain("kubernetes");
    expect(missing).toContain("terraform");
    expect(missing).not.toContain("vendor");
  });
});
