import { describe, expect, it } from "vitest";
import {
  computeOverrepresentedCompanies,
  isOverSeniorTitle,
  isUnderLeveledTitle,
} from "./job-search-agent";

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

  it(
    "regression: 'Principal' is also above the ceiling (confirmed 2026-07-28 — the candidate " +
      "rejected Assort Health's \"Principal, Strategic Partnerships (Health Systems)\" and " +
      "Fluidstack's \"Principal Electrical Operations Lead\" as too senior)",
    () => {
      expect(isOverSeniorTitle("Principal, Strategic Partnerships (Health Systems)")).toBe(true);
      expect(isOverSeniorTitle("Principal Electrical Operations Lead — Data Center Operations")).toBe(true);
      expect(isOverSeniorTitle("Principal, GTM Strategy")).toBe(true);
      expect(isOverSeniorTitle("Principal Business Operations Manager")).toBe(true);
    }
  );

  it("does not flag titles at or below the candidate's reach", () => {
    expect(isOverSeniorTitle("Senior Manager, Business Operations")).toBe(false);
    expect(isOverSeniorTitle("Manager, Strategy & Operations")).toBe(false);
    expect(isOverSeniorTitle("Business Operations Lead")).toBe(false);
    // Staff-level is still in reach; only Principal-and-above moved out.
    expect(isOverSeniorTitle("Staff Strategy & Operations Lead")).toBe(false);
  });
});

describe("isUnderLeveledTitle", () => {
  it(
    "regression: excludes trade/pre-professional titles that carry a legitimate ops domain word — " +
      'real case 2026-08-26, "Associate Data Center Operations Technician" (xAI) surfaced at 54 ' +
      'because classifyRoleFamily had a seniority ceiling but no floor',
    () => {
      expect(isUnderLeveledTitle("Associate Data Center Operations Technician")).toBe(true);
      expect(isUnderLeveledTitle("Network Operator, Data Center Operations")).toBe(true);
      expect(isUnderLeveledTitle("Field Installer, Infrastructure Operations")).toBe(true);
      expect(isUnderLeveledTitle("Business Operations Intern")).toBe(true);
    }
  );

  it("leaves management-level titles in the same domain untouched", () => {
    // The domain is the candidate's own — only the level disqualified above.
    expect(isUnderLeveledTitle("Data Center Operations Lead - Partner Site Operations")).toBe(false);
    expect(isUnderLeveledTitle("Infrastructure Operations Manager")).toBe(false);
    expect(isUnderLeveledTitle("AI Infrastructure Operations, Demand Planning")).toBe(false);
    expect(isUnderLeveledTitle("Business Operations Manager")).toBe(false);
    expect(isUnderLeveledTitle("Strategy & Operations Manager")).toBe(false);
  });

  it("does not fire on 'intern' inside 'internal', a real word in ops titles", () => {
    expect(isUnderLeveledTitle("Manager, Internal Business Operations")).toBe(false);
    expect(isUnderLeveledTitle("Internal Operations Strategy Lead")).toBe(false);
  });
});
