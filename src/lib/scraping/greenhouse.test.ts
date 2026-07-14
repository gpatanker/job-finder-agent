import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGreenhouseHtml, scrapeGreenhouse } from "./greenhouse";

const fixturesDir = path.join(__dirname, "__fixtures__");

describe("parseGreenhouseHtml", () => {
  it("extracts the essay textarea question and excludes standard fields", () => {
    const html = readFileSync(path.join(fixturesDir, "greenhouse-with-essay.html"), "utf-8");
    const result = parseGreenhouseHtml(html);

    expect(result.source).toBe("greenhouse");
    expect(result.questions).toHaveLength(2);
    const prompts = result.questions.map((q) => q.prompt);
    expect(prompts).toContain(
      "In 2–3 sentences, describe a specific project from your current or most recent role that you're proud of. What made it impactful?"
    );
    expect(prompts).toContain("How many years of related work experience do you have?");
    expect(prompts).not.toContain("First Name");
    expect(prompts).not.toContain("Email");
    expect(prompts).not.toContain("LinkedIn Profile");
  });

  it("returns no questions and a warning when only standard fields are present", () => {
    const html = readFileSync(path.join(fixturesDir, "greenhouse-no-essay.html"), "utf-8");
    const result = parseGreenhouseHtml(html);

    expect(result.questions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("excludes GitHub URL as a standard/short field, not a written prompt", () => {
    const html = readFileSync(path.join(fixturesDir, "greenhouse-no-essay.html"), "utf-8");
    const result = parseGreenhouseHtml(html);
    expect(result.questions.map((q) => q.prompt)).not.toContain("GitHub URL");
  });
});

describe("scrapeGreenhouse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    "regression: uses Greenhouse's public JSON API instead of HTML for job-boards.greenhouse.io " +
      "(that template renders its form client-side via a Nuxt SPA, so a plain HTML fetch sees " +
      "zero question markup — confirmed against a live posting)",
    async () => {
      const apiResponse = JSON.parse(
        readFileSync(path.join(fixturesDir, "greenhouse-api-response.json"), "utf-8")
      );
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => apiResponse,
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await scrapeGreenhouse(
        "https://job-boards.greenhouse.io/samsara/jobs/7761103"
      );

      expect(fetchMock).toHaveBeenCalledWith(
        "https://boards-api.greenhouse.io/v1/boards/samsara/jobs/7761103?questions=true",
        expect.anything()
      );
      expect(result.source).toBe("greenhouse");
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].prompt).toContain("describe a specific project");
    }
  );

  it("excludes multiple-choice questions, standard fields, and demographic-style labels even if textarea-typed", async () => {
    const apiResponse = JSON.parse(
      readFileSync(path.join(fixturesDir, "greenhouse-api-response.json"), "utf-8")
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => apiResponse })
    );

    const result = await scrapeGreenhouse("https://job-boards.greenhouse.io/samsara/jobs/7761103");
    const prompts = result.questions.map((q) => q.prompt);

    expect(prompts).not.toContain("First Name");
    expect(prompts).not.toContain("Resume/CV");
    expect(prompts).not.toContain("Do you accept the listed salary range for this position?");
    expect(prompts).not.toContain("How do you identify? (gender identity)");
  });

  it("falls back to HTML scraping when the URL doesn't match the boards-api id pattern", async () => {
    const html = readFileSync(path.join(fixturesDir, "greenhouse-with-essay.html"), "utf-8");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await scrapeGreenhouse("https://boards.greenhouse.io/embed/job_app?token=abc");

    expect(result.questions.length).toBeGreaterThan(0);
  });
});
