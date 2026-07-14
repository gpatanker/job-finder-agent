import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseGenericHtml } from "./generic";

describe("parseGenericHtml", () => {
  it("extracts a textarea prompt via its label[for] and excludes standard fields", () => {
    const html = readFileSync(
      path.join(__dirname, "__fixtures__", "generic-form.html"),
      "utf-8"
    );
    const result = parseGenericHtml(html);

    expect(result.source).toBe("generic");
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].prompt).toBe("Why do you want to work here?");
  });

  it("warns when no textarea is found", () => {
    const result = parseGenericHtml("<html><body><form><input type='text'/></form></body></html>");
    expect(result.questions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
