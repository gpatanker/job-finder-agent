import { describe, expect, it } from "vitest";
import { extractKeywords } from "./keywords";

describe("extractKeywords", () => {
  it("extracts meaningful terms and drops stopwords/short tokens", () => {
    const keywords = extractKeywords(
      "We are looking for a candidate with strong Python and SQL skills for vendor negotiation."
    );
    expect(keywords).toContain("python");
    expect(keywords).toContain("sql");
    expect(keywords).toContain("vendor");
    expect(keywords).toContain("negotiation");
    expect(keywords).not.toContain("for");
    expect(keywords).not.toContain("and");
    expect(keywords).not.toContain("we");
  });

  it("ranks more frequent terms first", () => {
    const keywords = extractKeywords("python python python sql sql java", 10);
    expect(keywords[0]).toBe("python");
    expect(keywords[1]).toBe("sql");
  });

  it("respects the limit", () => {
    const keywords = extractKeywords("alpha beta gamma delta epsilon", 2);
    expect(keywords).toHaveLength(2);
  });
});
