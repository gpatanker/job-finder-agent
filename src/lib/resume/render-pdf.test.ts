import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import { renderResumePdf } from "./render-pdf";
import type { ResumeData } from "@/lib/db/schema";

// Generic fixture data — deliberately not the real seeded resume, so this
// test runs in any environment without needing personal data present.
const fixtureResume: ResumeData = {
  name: "Jordan Example",
  contactLine: "(555) 555-0100 - jordan.example@example.com - linkedin.com/in/jordan-example/",
  education: [
    { school: "State University", degree: "B.S. in Business Administration" },
    { school: "Other College", degree: "A.A. in Something" },
  ],
  experience: [
    {
      company: "Example Corp",
      role: "Business Operations Analyst",
      team: "Strategy Team",
      location: "Austin, TX",
      dateRange: "Jan 2023 – Present",
      bullets: [
        {
          id: "example-1",
          text: "Reduced quarterly reporting cycle time by 30% by building a Python-based validation pipeline for sales data.",
          keywords: ["python", "reporting"],
          synonyms: {},
        },
        {
          id: "example-2",
          text: "Partnered with vendors to negotiate a 15% cost reduction on cloud infrastructure spend.",
          keywords: ["vendor negotiation"],
          synonyms: {},
        },
      ],
    },
  ],
  projects: [
    {
      name: "Capstone Project",
      org: "State University",
      dateRange: "2022",
      bullets: ["Built a data pipeline for athlete performance tracking."],
    },
  ],
  skills: [
    { category: "Analytics", items: ["SQL", "Python", "Tableau"] },
    { category: "Tools", items: ["Excel", "JIRA"] },
  ],
  certifications: ["Example Certification"],
};

describe("renderResumePdf", () => {
  it("produces a single-page PDF with correct metadata and real extractable text", async () => {
    const buffer = await renderResumePdf(fixtureResume, {
      author: "Test Author",
      title: "Test Resume",
    });

    expect(buffer.length).toBeGreaterThan(1000);

    const parser = new PDFParse({ data: buffer });
    const info = await parser.getInfo();
    expect(info.info.Author).toBe("Test Author");
    expect(info.info.Title).toBe("Test Resume");
    expect(info.info.Producer).toBe("PDFKit");

    const textResult = await parser.getText();
    expect(textResult.total).toBe(1);

    // Real embedded text (ATS-friendly), not image-only
    expect(textResult.text).toContain("Jordan Example");
    expect(textResult.text).toContain("Example Corp");
    expect(textResult.text).toContain(
      "Reduced quarterly reporting cycle time by 30%"
    );
    expect(textResult.text).toContain("Python, Tableau");

    await parser.destroy();
  });

  it("never renders bullet text that isn't in the source data (no fabrication)", async () => {
    const buffer = await renderResumePdf(fixtureResume);
    const parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    // Sanity: nothing about a company/role that was never in the fixture
    expect(textResult.text).not.toContain("Palantir");
    await parser.destroy();
  });

  it("golden master: extracted text matches the last known-good layout exactly", async () => {
    const buffer = await renderResumePdf(fixtureResume);
    const parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    await parser.destroy();
    // If this snapshot needs to change, the diff should be an intentional
    // layout change you're reviewing — not a surprise from an unrelated edit.
    expect(textResult.text).toMatchSnapshot();
  });
});
