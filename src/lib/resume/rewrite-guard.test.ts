import { describe, expect, it } from "vitest";
import { validateRewrite } from "./rewrite-guard";

const SLA =
  "Recovered $3M in SLA credits by building and owning a monthly node outage analysis process across 12 CSP providers, calculating downtime, validating credit eligibility, and negotiating directly with vendors.";
const BAD_DEBT =
  "Reduced monthly bad debt from 4.8% to 1.5% by developing a strategic multi-level policy and engineering a Python script to automate collection emails, improving collections rate by 10% and reducing manual workload by ~2 hours weekly";

describe("validateRewrite — accepts faithful rewording", () => {
  it("accepts a reword that keeps every number and entity", () => {
    const r =
      "Recovered $3M in SLA credits by designing and operating a monthly node outage analysis workflow across 12 CSP providers, quantifying downtime, validating credit eligibility, and negotiating directly with vendors.";
    expect(validateRewrite(SLA, r)).toEqual({ ok: true });
  });

  it("accepts an identical string as a no-op", () => {
    expect(validateRewrite(SLA, SLA)).toEqual({ ok: true });
  });

  it("allows the opening action verb to change", () => {
    const r = SLA.replace("Recovered", "Drove recovery of");
    expect(validateRewrite(SLA, r).ok).toBe(true);
  });
});

describe("validateRewrite — blocks fabrication", () => {
  it("rejects an invented metric", () => {
    const r =
      "Recovered $3M in SLA credits — a 35% improvement — by building and owning a monthly node outage analysis process across 12 CSP providers, calculating downtime, validating credit eligibility, and negotiating directly with vendors.";
    const res = validateRewrite(SLA, r);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/introduced number/);
  });

  it("rejects a changed magnitude", () => {
    const res = validateRewrite(SLA, SLA.replace("$3M", "$3B"));
    expect(res.ok).toBe(false);
  });

  it("rejects a reformatted number, even though the value is the same", () => {
    // "$3M" -> "$3 million" is faithful, but permitting reformatting makes
    // "$3M" -> "$3B" indistinguishable from it at validation time.
    const res = validateRewrite(SLA, SLA.replace("$3M", "$3 million"));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/missing or reformatted/);
  });

  it("rejects a dropped number", () => {
    const res = validateRewrite(SLA, SLA.replace(" across 12 CSP providers", " across CSP providers"));
    expect(res.ok).toBe(false);
  });

  it("rejects an invented tool or system", () => {
    const r = SLA.replace("node outage analysis process", "Datadog-based node outage analysis process");
    const res = validateRewrite(SLA, r);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/unsupported term/i);
  });

  it("rejects dropping an entity that carried context", () => {
    const r = SLA.replace("SLA credits", "credits").replace("12 CSP providers", "12 providers");
    const res = validateRewrite(SLA, r);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/dropped context/);
  });

  it("keeps every number in a multi-metric bullet", () => {
    const r = BAD_DEBT.replace("improving collections rate by 10%", "improving collections rate");
    expect(validateRewrite(BAD_DEBT, r).ok).toBe(false);
  });

  it("accepts a faithful reword of a multi-metric bullet", () => {
    const r =
      "Cut monthly bad debt from 4.8% to 1.5% by designing a strategic multi-level policy and engineering a Python script to automate collection emails, improving collections rate by 10% and reducing manual workload by ~2 hours weekly";
    expect(validateRewrite(BAD_DEBT, r)).toEqual({ ok: true });
  });
});

describe("validateRewrite — blocks degenerate output", () => {
  it("rejects an empty rewrite", () => {
    expect(validateRewrite(SLA, "   ").ok).toBe(false);
  });

  it("rejects a bullet padded far beyond the original", () => {
    const r = SLA + " " + SLA.replace(/\$3M|12/g, "");
    expect(validateRewrite(SLA, r).ok).toBe(false);
  });

  it("rejects a rewrite gutted down to a fragment", () => {
    expect(validateRewrite(SLA, "Recovered $3M in SLA credits from 12 CSP providers.").ok).toBe(false);
  });
});

describe("validateRewrite — the leading verb", () => {
  it("allows any action verb in the lead position, not a fixed allowlist", () => {
    for (const verb of ["Cut", "Slashed", "Trimmed", "Halved", "Curtailed"]) {
      const r = BAD_DEBT.replace("Reduced", verb);
      expect(validateRewrite(BAD_DEBT, r), verb).toEqual({ ok: true });
    }
  });

  it("still rejects an unsupported acronym in the lead position", () => {
    const r = SLA.replace("Recovered", "AWS recovered");
    expect(validateRewrite(SLA, r).ok).toBe(false);
  });
});

describe("validateRewrite — pre-approved synonym vocabulary", () => {
  const GTM =
    "Developed a Tableau dashboard to track GPU capacity for sales teams, ensuring utilization rate went from 88% to 95%, complementing go-to-market efforts";

  it("rejects an unfamiliar acronym when nothing supports it", () => {
    const r = GTM.replace("go-to-market efforts", "GTM efforts");
    expect(validateRewrite(GTM, r).ok).toBe(false);
  });

  it("accepts that same wording when it is a pre-approved synonym for the bullet", () => {
    const r = GTM.replace("go-to-market efforts", "GTM efforts");
    expect(validateRewrite(GTM, r, ["go-to-market efforts", "GTM efforts", "sales and marketing efforts"])).toEqual({ ok: true });
  });

  it("still rejects an invented tool even with approved vocabulary present", () => {
    const r = GTM.replace("Tableau dashboard", "Looker dashboard");
    expect(validateRewrite(GTM, r, ["GTM efforts"]).ok).toBe(false);
  });
});
