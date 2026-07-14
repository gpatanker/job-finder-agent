import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseGreenhouseHtml } from "./greenhouse";

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
