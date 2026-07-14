import { describe, expect, it } from "vitest";
import {
  computeTotalExperienceMonths,
  formatExperienceSummary,
  parseDateRange,
} from "./experience";
import type { ResumeExperienceEntry } from "@/lib/db/schema";

function entry(dateRange: string): ResumeExperienceEntry {
  return { company: "X", role: "Y", dateRange, bullets: [] };
}

describe("parseDateRange", () => {
  it("parses abbreviated month names with an en dash", () => {
    const range = parseDateRange("Mar 2022 – May 2024", new Date("2026-07-13"));
    expect(range?.start).toEqual(new Date(2022, 2, 1));
    expect(range?.end).toEqual(new Date(2024, 4, 1));
  });

  it("parses full month names with a hyphen", () => {
    const range = parseDateRange("June 2024 - March 2025", new Date("2026-07-13"));
    expect(range?.start).toEqual(new Date(2024, 5, 1));
    expect(range?.end).toEqual(new Date(2025, 2, 1));
  });

  it("resolves 'Present' to the asOf date", () => {
    const asOf = new Date("2026-07-13");
    const range = parseDateRange("Feb 2026 – Present", asOf);
    expect(range?.end).toEqual(asOf);
  });

  it("returns null for a range it can't confidently parse, rather than guessing", () => {
    expect(parseDateRange("Sometime last year", new Date())).toBeNull();
    expect(parseDateRange("2022", new Date())).toBeNull();
  });
});

describe("computeTotalExperienceMonths", () => {
  it(
    "regression: reproduces the real ~3.3-year total for the seeded resume's non-overlapping roles " +
      "(this matters because a Samsara posting asked 'do you have 8+ years experience' — the answer " +
      "must come from actual math, never be assumed true)",
    () => {
      const asOf = new Date("2026-07-13");
      const experience = [
        entry("Mar 2022 – May 2024"),
        entry("June 2024 – March 2025"),
        entry("Feb 2026 – Present"),
      ];
      const months = computeTotalExperienceMonths(experience, asOf);
      // 26 (Mar22-May24) + 9 (Jun24-Mar25) + 5 (Feb26-Jul26) = 40 months (~3.3y),
      // well short of an 8-year threshold — the honest answer here is "No".
      expect(months).toBe(40);
      expect(months / 12).toBeLessThan(8);
    }
  );

  it("merges overlapping roles instead of double-counting them", () => {
    const asOf = new Date("2025-01-01");
    const experience = [
      entry("Jan 2020 – Dec 2022"),
      entry("Jun 2021 – Jun 2023"), // overlaps with the role above
    ];
    // Combined span is Jan 2020 – Jun 2023 = 41 months, not 36 + 24 = 60.
    expect(computeTotalExperienceMonths(experience, asOf)).toBe(41);
  });

  it("ignores unparseable ranges rather than throwing", () => {
    const experience = [entry("Mar 2022 – May 2024"), entry("a while back")];
    expect(() => computeTotalExperienceMonths(experience, new Date("2026-01-01"))).not.toThrow();
  });
});

describe("formatExperienceSummary", () => {
  it("flags roles excluded due to unparseable date ranges", () => {
    const experience = [entry("Mar 2022 – May 2024"), entry("a while back")];
    const summary = formatExperienceSummary(experience, new Date("2026-01-01"));
    expect(summary).toContain("1 role(s) had a date range that couldn't be parsed");
  });
});
