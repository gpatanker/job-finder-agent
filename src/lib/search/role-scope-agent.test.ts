import { describe, expect, it } from "vitest";
import { validateDerivedScope } from "./role-scope-agent";
import { OPS_ROLE_SCOPE, PRODUCT_ROLE_SCOPE, type RoleScope } from "./role-scope";

/** A plausible software-engineering scope, the case the old defaults got wrong. */
const SWE_SCOPE: RoleScope = {
  label: "Backend Software Engineering",
  headTerms: ["engineer", "engineering", "developer", "swe"],
  secondaryHeadTerms: [],
  bareHeadIsCore: true,
  coreDomains: ["backend", "software", "platform", "infrastructure", "distributed systems", "api"],
  adjacentDomains: ["full stack", "data", "devops", "reliability", "security"],
  disqualifyingDomains: ["sales", "recruiting", "marketing", "hardware", "mechanical", "civil"],
  conditionalDomains: ["support", "manufacturing"],
  titlePhrases: ["Senior Software Engineer", "Backend Engineer", "Staff Engineer", "Platform Engineer", "Infrastructure Engineer"],
  excludedDomains: [],
  rescuePhrases: [],
  // "staff" and "principal" deliberately absent — senior IC titles in engineering.
  overSeniorTerms: ["director", "head of", "vice president", "vp", "svp", "evp", "chief"],
  underLeveledTerms: ["intern", "apprentice"],
  rubricRules: "- Higher for: backend/platform/infrastructure engineering titles.\n\nSENIORITY CEILING — up to Staff/Principal IC; no Director or above.",
};

describe("validateDerivedScope", () => {
  it("accepts a coherent scope that admits the candidate's own stated targets", () => {
    const r = validateDerivedScope(SWE_SCOPE, [
      "Software Engineer",
      "Senior Software Engineer",
      "Backend Engineer",
      "Staff Engineer",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it(
    "rejects a scope that disqualifies its own head term — the exact failure that made a software " +
      "engineer's search silently return nothing, since the inherited ops scope disqualified \"engineer\"",
    () => {
      const broken: RoleScope = {
        ...SWE_SCOPE,
        disqualifyingDomains: [...SWE_SCOPE.disqualifyingDomains, "engineer"],
      };
      const r = validateDerivedScope(broken, ["Software Engineer"]);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain("both headTerms and disqualifyingDomains");
        expect(r.error).toContain("engineer");
      }
    }
  );

  it("rejects a term present in both coreDomains and disqualifyingDomains", () => {
    const broken: RoleScope = { ...SWE_SCOPE, disqualifyingDomains: ["backend"] };
    const r = validateDerivedScope(broken, ["Backend Engineer"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("coreDomains and disqualifyingDomains");
  });

  it("rejects an empty headTerms, which would reject every title", () => {
    const r = validateDerivedScope({ ...SWE_SCOPE, headTerms: [] }, ["Software Engineer"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("headTerms is empty");
  });

  it("rejects empty rubricRules, since the scorer would get no candidate-specific guidance", () => {
    const r = validateDerivedScope({ ...SWE_SCOPE, rubricRules: "   " }, ["Software Engineer"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("rubricRules is empty");
  });

  it("rejects rescuePhrases with nothing to rescue from", () => {
    const r = validateDerivedScope({ ...SWE_SCOPE, rescuePhrases: ["platform engineering"] }, [
      "Software Engineer",
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("no excludedDomains");
  });

  it(
    "the self-check: a scope that rejects EVERY stated role family is wrong by construction, " +
      "regardless of how reasonable its word lists look in isolation",
    () => {
      // The product scope is internally coherent — it just isn't this candidate's.
      // (Given rubricRules, since the presets ship it empty on purpose and that
      // check would otherwise fire first.)
      const r = validateDerivedScope({ ...PRODUCT_ROLE_SCOPE, rubricRules: "- product rules" }, [
        "Software Engineer",
        "Backend Engineer",
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("rejects EVERY role family");
    }
  );

  it("warns rather than failing when only SOME stated families are rejected, since one may be aspirational", () => {
    const r = validateDerivedScope(SWE_SCOPE, [
      "Software Engineer",
      "Director of Engineering", // above the stated ceiling
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.join(" ")).toContain("Director of Engineering");
      expect(r.warnings.join(" ")).toContain("1 of 2");
    }
  });

  it("warns when bareHeadIsCore is paired with a generic head term that every profession has", () => {
    const r = validateDerivedScope(
      { ...OPS_ROLE_SCOPE, bareHeadIsCore: true, rubricRules: "x" },
      ["Business Operations Manager"]
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(" ")).toContain("generic head term");
  });

  it("warns when there are no disqualifying domains at all", () => {
    const r = validateDerivedScope({ ...SWE_SCOPE, disqualifyingDomains: [] }, [
      "Software Engineer",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(" ")).toContain("no disqualifyingDomains");
  });

  it("ignores blank entries in the stated families rather than counting them as rejections", () => {
    const r = validateDerivedScope(SWE_SCOPE, ["Software Engineer", "", "   "]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});
