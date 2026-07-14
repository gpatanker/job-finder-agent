import { describe, expect, it } from "vitest";
import { slugify, resumeSlugForJob } from "./slug";

describe("slugify", () => {
  it("lowercases and replaces non-alphanumeric runs with a hyphen", () => {
    expect(slugify("Snorkel AI — Senior Business Ops!")).toBe("snorkel-ai-senior-business-ops");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  --Weird--  ")).toBe("weird");
  });
});

describe("resumeSlugForJob", () => {
  it("combines company, title, and a short job id prefix", () => {
    const slug = resumeSlugForJob("Snorkel AI", "Senior BizOps Manager", "abcdef12-3456-7890");
    expect(slug).toBe("snorkel-ai-senior-bizops-manager-abcdef12");
  });
});
