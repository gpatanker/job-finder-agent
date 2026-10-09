import { describe, expect, it } from "vitest";
import {
  OPS_ROLE_SCOPE,
  PRODUCT_ROLE_SCOPE,
  resolveRoleScope,
  type RoleScope,
} from "./role-scope";
import { classifyRoleFamily, isSalesSideGtmTitle } from "./known-company-boards";
import { isOverSeniorTitle, isUnderLeveledTitle } from "./job-search-agent";

describe("resolveRoleScope", () => {
  it("falls back to the operations scope when nothing is configured, so an existing instance is unaffected", () => {
    expect(resolveRoleScope(undefined)).toBe(OPS_ROLE_SCOPE);
    expect(resolveRoleScope(null)).toBe(OPS_ROLE_SCOPE);
  });

  it("resolves a built-in scope by name", () => {
    expect(resolveRoleScope("product")).toBe(PRODUCT_ROLE_SCOPE);
    expect(resolveRoleScope("ops")).toBe(OPS_ROLE_SCOPE);
  });

  it("falls back rather than throwing on an unknown name — a typo in seed data must not break search", () => {
    expect(resolveRoleScope("prodcut")).toBe(OPS_ROLE_SCOPE);
  });

  it("extends a preset so a fork can override a few lists without restating the whole object", () => {
    const scope = resolveRoleScope({
      extends: "product",
      disqualifyingDomains: [...PRODUCT_ROLE_SCOPE.disqualifyingDomains, "design"],
    });
    expect(scope.label).toBe(PRODUCT_ROLE_SCOPE.label);
    expect(scope.bareHeadIsCore).toBe(true);
    expect(scope.disqualifyingDomains).toContain("design");
    // Untouched lists come through from the preset.
    expect(scope.headTerms).toEqual(PRODUCT_ROLE_SCOPE.headTerms);
  });

  it("strips `_`-prefixed documentation keys, since JSON has no comments", () => {
    const scope = resolveRoleScope({
      extends: "product",
      _comment: "explanatory text in the seed template",
      _why: "another note",
    } as Parameters<typeof resolveRoleScope>[0]);
    expect(scope).not.toHaveProperty("_comment");
    expect(scope).not.toHaveProperty("_why");
    expect(scope.headTerms).toEqual(PRODUCT_ROLE_SCOPE.headTerms);
  });

  it("ignores null/undefined overrides so a half-filled template field falls back to the preset instead of blanking a word list", () => {
    const scope = resolveRoleScope({
      extends: "product",
      coreDomains: undefined,
      adjacentDomains: null,
    } as unknown as Parameters<typeof resolveRoleScope>[0]);
    expect(scope.coreDomains).toEqual(PRODUCT_ROLE_SCOPE.coreDomains);
    expect(scope.adjacentDomains).toEqual(PRODUCT_ROLE_SCOPE.adjacentDomains);
  });

  it("accepts a fully inline scope with no preset", () => {
    const scope = resolveRoleScope({ label: "Custom", headTerms: ["design"] });
    expect(scope.label).toBe("Custom");
    expect(scope.headTerms).toEqual(["design"]);
  });
});

describe("classifyRoleFamily is retargetable by scope", () => {
  it(
    "regression: a product candidate's own target titles were rejected before the scope was data. " +
      "classifyRoleFamily('Product Manager') returned null under the ops scope, so the free " +
      "job-board channel dropped every PM role before scoring ever ran",
    () => {
      // The bug, preserved as the documented ops behaviour:
      expect(classifyRoleFamily("Product Manager", OPS_ROLE_SCOPE)).toBeNull();
      expect(classifyRoleFamily("Senior Product Manager", OPS_ROLE_SCOPE)).toBeNull();
      // The fix:
      expect(classifyRoleFamily("Product Manager", PRODUCT_ROLE_SCOPE)).toBe("core");
      expect(classifyRoleFamily("Senior Product Manager", PRODUCT_ROLE_SCOPE)).toBe("core");
    }
  );

  it("keeps the ops scope's own corpus classifying exactly as before", () => {
    expect(classifyRoleFamily("Business Operations Manager", OPS_ROLE_SCOPE)).toBe("core");
    expect(classifyRoleFamily("Strategy & Operations Manager", OPS_ROLE_SCOPE)).toBe("strategy-ops");
    expect(classifyRoleFamily("Revenue Operations Manager", OPS_ROLE_SCOPE)).toBeNull();
    expect(classifyRoleFamily("Recruiting Operations Manager", OPS_ROLE_SCOPE)).toBeNull();
    // The default argument must be the ops scope, not merely equivalent to it.
    expect(classifyRoleFamily("Business Operations Manager")).toBe("core");
    expect(classifyRoleFamily("Product Manager")).toBeNull();
  });

  it(
    "bareHeadIsCore is the one genuinely semantic difference between families: a bare head noun " +
      "is noise for operations (every profession has an operations manager) and is the target for product",
    () => {
      expect(OPS_ROLE_SCOPE.bareHeadIsCore).toBe(false);
      expect(PRODUCT_ROLE_SCOPE.bareHeadIsCore).toBe(true);
      // Same title, opposite verdicts, driven only by that flag.
      expect(classifyRoleFamily("Operations Manager", OPS_ROLE_SCOPE)).toBeNull();
      const opsWithBareHead: RoleScope = { ...OPS_ROLE_SCOPE, bareHeadIsCore: true };
      expect(classifyRoleFamily("Operations Manager", opsWithBareHead)).toBe("core");
    }
  );

  it("still rejects a wrong-profession title under a product scope", () => {
    expect(classifyRoleFamily("Product Marketing Manager", PRODUCT_ROLE_SCOPE)).toBeNull();
    expect(classifyRoleFamily("Recruiting Coordinator", PRODUCT_ROLE_SCOPE)).toBeNull();
    // ...and a title with no product head noun at all.
    expect(classifyRoleFamily("Business Operations Manager", PRODUCT_ROLE_SCOPE)).toBeNull();
  });

  it("the excluded-family carve-out is opt-in, so a scope without one is unaffected by it", () => {
    // Ops uses it for go-to-market, rescued by an explicit Business Operations phrase.
    expect(isSalesSideGtmTitle("GTM Strategy & Operations Manager", OPS_ROLE_SCOPE)).toBe(true);
    expect(isSalesSideGtmTitle("Business & Revenue Operations Associate", OPS_ROLE_SCOPE)).toBe(false);
    // Product declares no excluded family, so the check short-circuits to false
    // rather than matching on a stale word list.
    expect(PRODUCT_ROLE_SCOPE.excludedDomains).toHaveLength(0);
    expect(isSalesSideGtmTitle("Growth Product Manager", PRODUCT_ROLE_SCOPE)).toBe(false);
    expect(classifyRoleFamily("Growth Product Manager", PRODUCT_ROLE_SCOPE)).toBe("core");
  });
});

describe("seniority band is scope-driven", () => {
  it(
    'regression: "principal" is an executive level in operations but a senior IC title in product. ' +
      "Hardcoding it as over-senior would reject a product candidate's natural next role",
    () => {
      expect(isOverSeniorTitle("Principal Product Manager", OPS_ROLE_SCOPE)).toBe(true);
      expect(isOverSeniorTitle("Principal Product Manager", PRODUCT_ROLE_SCOPE)).toBe(false);
      // Both agree on actual executive titles.
      expect(isOverSeniorTitle("Director of Product", PRODUCT_ROLE_SCOPE)).toBe(true);
      expect(isOverSeniorTitle("VP of Product", PRODUCT_ROLE_SCOPE)).toBe(true);
    }
  );

  it("defaults to the ops band when no scope is passed", () => {
    expect(isOverSeniorTitle("Principal Business Operations Manager")).toBe(true);
    expect(isOverSeniorTitle("Senior Business Operations Manager")).toBe(false);
  });

  it("matches whole words only, so 'intern' does not fire inside 'internal'", () => {
    expect(isUnderLeveledTitle("Manager, Internal Business Operations")).toBe(false);
    expect(isUnderLeveledTitle("Business Operations Intern")).toBe(true);
    expect(isUnderLeveledTitle("Product Management Intern", PRODUCT_ROLE_SCOPE)).toBe(true);
    expect(isUnderLeveledTitle("Senior Product Manager", PRODUCT_ROLE_SCOPE)).toBe(false);
  });

  it("escapes regex metacharacters in scope terms rather than building a broken pattern", () => {
    const scope: RoleScope = { ...OPS_ROLE_SCOPE, overSeniorTerms: ["c++", "head of"] };
    expect(() => isOverSeniorTitle("Head of Operations", scope)).not.toThrow();
    expect(isOverSeniorTitle("Head of Operations", scope)).toBe(true);
  });
});

describe("the ops scope still carries its own rubric prose", () => {
  it("keeps the candidate-specific scoring rules as data, so the prompt is unchanged for that instance", () => {
    expect(OPS_ROLE_SCOPE.rubricRules).toContain("FINANCE and MARKETING are hard exclusions");
    expect(OPS_ROLE_SCOPE.rubricRules).toContain("SENIORITY CEILING");
    expect(OPS_ROLE_SCOPE.rubricRules).toContain("GO-TO-MARKET AND REVENUE-MOTION OPERATIONS");
  });

  it(
    "gives every built-in preset usable rubric rules. An earlier version shipped them empty to force " +
      "a fork to write its own, which was wrong: the prose is interpolated straight into the scorer's " +
      "prompt, so empty means NO candidate guidance at all — strictly worse than a sensible default. " +
      "A derived scope still gets candidate-specific rules, and validateDerivedScope rejects an empty one",
    () => {
      expect(PRODUCT_ROLE_SCOPE.rubricRules).toContain("PRODUCT MARKETING is a hard exclusion");
      expect(PRODUCT_ROLE_SCOPE.rubricRules).toContain("SENIORITY CEILING");
      // The IC-track nuance a generic ops rubric gets wrong for product.
      expect(PRODUCT_ROLE_SCOPE.rubricRules).toContain("Do NOT treat STAFF or PRINCIPAL as too senior");
    }
  );

  it("gives every preset its own query-phrase pool, so a paid run searches for the right job", () => {
    expect(OPS_ROLE_SCOPE.titlePhrases.length).toBeGreaterThan(20);
    expect(PRODUCT_ROLE_SCOPE.titlePhrases.length).toBeGreaterThan(20);
    // Every product phrase names the function; none is an operations title.
    expect(PRODUCT_ROLE_SCOPE.titlePhrases.every((t) => /product/i.test(t))).toBe(true);
    expect(OPS_ROLE_SCOPE.titlePhrases.some((t) => /product/i.test(t))).toBe(true); // "Product Operations Manager"
  });
});
