import { describe, expect, it } from "vitest";
import { computeOverrepresentedCompanies } from "./job-search-agent";

describe("computeOverrepresentedCompanies", () => {
  it(
    "regression: flags companies with 3+ prior suggestions so the agent can deprioritize them " +
      "(real case: 18 distinct companies covered 53 total suggestions, with several famous AI " +
      "labs re-suggested many times while the agent never branched into adjacent industries)",
    () => {
      const knownJobs = [
        { company: "Anthropic", title: "TPM, Compute" },
        { company: "Anthropic", title: "TPM, Data Center Infrastructure" },
        { company: "Anthropic", title: "Strategy & Ops Manager" },
        { company: "OpenAI", title: "Business Operations Manager" },
        { company: "OpenAI", title: "GTM Strategy & Operations" },
        { company: "Figma", title: "TPM, AI Research" },
      ];
      const result = computeOverrepresentedCompanies(knownJobs);
      expect(result).toEqual(["Anthropic (3 prior suggestions)"]);
    }
  );

  it("returns an empty list when no company has 3+ prior suggestions", () => {
    const knownJobs = [
      { company: "Acme", title: "Role A" },
      { company: "Acme", title: "Role B" },
      { company: "Widgets Inc", title: "Role C" },
    ];
    expect(computeOverrepresentedCompanies(knownJobs)).toEqual([]);
  });

  it("sorts by frequency descending", () => {
    const knownJobs = [
      { company: "A", title: "1" },
      { company: "A", title: "2" },
      { company: "A", title: "3" },
      { company: "A", title: "4" },
      { company: "B", title: "1" },
      { company: "B", title: "2" },
      { company: "B", title: "3" },
    ];
    expect(computeOverrepresentedCompanies(knownJobs)).toEqual([
      "A (4 prior suggestions)",
      "B (3 prior suggestions)",
    ]);
  });
});
