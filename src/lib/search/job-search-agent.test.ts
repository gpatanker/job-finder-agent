import { describe, expect, it } from "vitest";
import { computeOverrepresentedCompanies, isOverSeniorTitle } from "./job-search-agent";

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

describe("isOverSeniorTitle", () => {
  it(
    "regression: flags Director/Head of/VP titles above the candidate's actual reach " +
      "(real case: search surfaced \"Airwallex — Director, Revenue Strategy & Operations\" " +
      "and \"OpenFX — Head of Business Operations\" though the candidate's ceiling is Senior Manager)",
    () => {
      expect(isOverSeniorTitle("Director, Revenue Strategy & Operations")).toBe(true);
      expect(isOverSeniorTitle("Head of Business Operations")).toBe(true);
      expect(isOverSeniorTitle("Associate Director, Strategy & Operations")).toBe(true);
      expect(isOverSeniorTitle("Senior Director, GTM Operations")).toBe(true);
      expect(isOverSeniorTitle("VP of Operations")).toBe(true);
      expect(isOverSeniorTitle("Vice President, Business Operations")).toBe(true);
    }
  );

  it("does not flag titles at or below the candidate's reach", () => {
    expect(isOverSeniorTitle("Senior Manager, Business Operations")).toBe(false);
    expect(isOverSeniorTitle("Manager, Strategy & Operations")).toBe(false);
    expect(isOverSeniorTitle("Business Operations Lead")).toBe(false);
    expect(isOverSeniorTitle("Principal, GTM Strategy")).toBe(false);
  });
});
