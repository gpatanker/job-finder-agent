import Anthropic from "@anthropic-ai/sdk";
import { logAnthropicUsage } from "@/lib/observability/llm-usage";
import { classifyRoleFamily } from "./known-company-boards";
import { isOverSeniorTitle, isUnderLeveledTitle } from "./job-search-agent";
import { OPS_ROLE_SCOPE, PRODUCT_ROLE_SCOPE, type RoleScope } from "./role-scope";

/**
 * Derives a candidate's role scope from what they said they want.
 *
 * Before this, the scope was a second thing you had to author by hand after
 * already stating your target roles — two disconnected sources of truth, and
 * they only agreed for the original author because he wrote both. A new
 * candidate could say "Backend Engineer" in `roleFamilies` and still inherit a
 * scope in which "engineer" is a DISQUALIFYING term, so every role they wanted
 * was rejected with no explanation.
 *
 * So: the candidate's own words are the input, and the scope is generated from
 * them once at setup, reviewed, and stored. Search then reads stored data and
 * stays deterministic and free — no per-run model call, and a bad generation is
 * visible in the profile rather than silently re-rolled on every search.
 *
 * The generation is bounded the same way everything else in this project is:
 * the model proposes, and code decides whether to accept. See
 * validateDerivedScope for what has to hold — in particular the self-check that
 * the generated scope must actually ACCEPT the role families the candidate
 * named, which is what catches an inverted or over-eager exclusion list.
 */

const MODEL = "claude-sonnet-5";

export type ScopeDerivationInput = {
  /** Exact title phrases the candidate said they're targeting. */
  roleFamilies: string[];
  /** Free-text: what they do, what level, what they explicitly don't want. */
  targetStatement?: string | null;
  /** Coarse function labels from the profile, if present. */
  functionTags?: string[];
};

export type ScopeDerivationResult =
  | { ok: true; scope: RoleScope; warnings: string[] }
  | { ok: false; error: string };

const TOOL = {
  name: "submit_role_scope",
  description:
    "Define what counts as this candidate's function, as the word lists a title filter will use.",
  input_schema: {
    type: "object" as const,
    properties: {
      label: {
        type: "string",
        description: 'Short human label for this role family, e.g. "Backend Software Engineering".',
      },
      headTerms: {
        type: "array",
        items: { type: "string" },
        description:
          "The function itself. A job title containing NONE of these is rejected outright, however good the rest looks. Lowercase single words or short phrases. For a software engineer: engineer, engineering, developer, swe. Keep it to the nouns that name the job, not qualifiers.",
      },
      secondaryHeadTerms: {
        type: "array",
        items: { type: "string" },
        description:
          'A second head noun that qualifies in combination with the primary one. For operations this is "strategy"/"strategic", which is why "Strategy & Operations" classifies. Often empty — only include if there is a genuine second word that names the same job.',
      },
      bareHeadIsCore: {
        type: "boolean",
        description:
          'Whether a head term ALONE is enough to count as a strong match. TRUE when the head noun IS the job and needs no qualifier ("Product Manager", "Software Engineer"). FALSE when the bare title is too generic to be meaningful because every profession has one ("Operations Manager", "Program Manager") and a domain qualifier is required. Get this right: it is the single most consequential field.',
      },
      coreDomains: {
        type: "array",
        items: { type: "string" },
        description:
          "Qualifiers that make a title a STRONG match for this candidate — their specialisms, surfaces, and domains. Scored highest.",
      },
      adjacentDomains: {
        type: "array",
        items: { type: "string" },
        description:
          "Qualifiers worth surfacing but a weaker fit. Scored lower, not rejected.",
      },
      disqualifyingDomains: {
        type: "array",
        items: { type: "string" },
        description:
          "Hard rejects: a different profession that happens to share the head noun, rejected even when a core domain is also present. Derive these from what the candidate said they DON'T want, plus the obvious siblings. CRITICAL: never put a term here that also appears in headTerms or coreDomains — that would reject every role the candidate wants.",
      },
      conditionalDomains: {
        type: "array",
        items: { type: "string" },
        description:
          "Domains allowed ONLY when a head or secondary-head word is also present. Use for adjacent fields the candidate would take in their own function but not as a career change.",
      },
      excludedDomains: {
        type: "array",
        items: { type: "string" },
        description:
          "An optional carve-out: a family to exclude that the domain lists would otherwise admit. Leave EMPTY unless the candidate described a genuine 'I want X-ops but not Y-ops' distinction.",
      },
      rescuePhrases: {
        type: "array",
        items: { type: "string" },
        description:
          "Phrases that rescue a title from excludedDomains. Only meaningful if excludedDomains is non-empty.",
      },
      overSeniorTerms: {
        type: "array",
        items: { type: "string" },
        description:
          'Levels ABOVE the candidate\'s reach, matched as whole words. Be careful with "principal" and "staff": in engineering and product these are senior IC titles that a senior candidate actively wants, while in operations they read as executive. Only include them if the candidate\'s stated ceiling genuinely excludes them.',
      },
      underLeveledTerms: {
        type: "array",
        items: { type: "string" },
        description:
          'Levels BELOW the candidate, matched as whole words — trade or pre-professional titles. Usually includes intern and apprentice. Include "associate"/"junior" ONLY if the candidate\'s stated floor excludes them.',
      },
      rubricRules: {
        type: "string",
        description:
          "The candidate-specific half of an LLM scoring rubric, as markdown-ish bullet lines. State the in-scope families, each hard exclusion WITH the reason the candidate gave, and a SENIORITY CEILING paragraph naming their floor and ceiling. Write it as instructions to a scorer. This is prose a human will read and edit, so be specific and cite the candidate's own reasoning rather than inventing rules.",
      },
    },
    required: [
      "label",
      "headTerms",
      "bareHeadIsCore",
      "coreDomains",
      "adjacentDomains",
      "disqualifyingDomains",
      "overSeniorTerms",
      "underLeveledTerms",
      "rubricRules",
    ],
  },
};

const SYSTEM_PROMPT = `You define job-title filters. Given a candidate's own description of the roles they want, you produce the word lists a title classifier uses to decide which of thousands of open postings are worth scoring.

How the filter works, so your lists land correctly:
  1. A title containing none of headTerms is rejected outright.
  2. A title containing any disqualifyingDomains term is rejected, even if it also matches a core domain. These are "different profession, same noun" cases.
  3. conditionalDomains are allowed only alongside a head or secondary-head word.
  4. Otherwise the title's tier comes from which qualifier it carries: coreDomains beats adjacentDomains.
  5. Separately, overSeniorTerms and underLeveledTerms reject titles outside the candidate's level band.

Three ways people get this wrong, so don't:
  - Putting a term in BOTH headTerms and disqualifyingDomains. That rejects everything the candidate wants. The classic is a software engineer whose scope disqualifies "engineer".
  - Getting bareHeadIsCore backwards. Ask: is the bare head noun plus a level the actual job ("Software Engineer", "Product Manager")? Then true. Or is it so generic that every profession has one ("Operations Manager", "Program Manager")? Then false, and require a domain qualifier.
  - Treating "principal" and "staff" as too senior. In engineering and product they are senior individual-contributor titles. Only exclude them if the candidate's stated ceiling actually rules them out.

Be generous with headTerms and coreDomains — recall matters more than precision at this stage, because a human reviews every suggestion before applying. Be conservative with disqualifyingDomains: only list what the candidate actually ruled out, plus its obvious siblings.

Respond only via the submit_role_scope tool.`;

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().toLowerCase()))]
    : [];
}

/**
 * Accepts a generated scope only if it could actually work.
 *
 * The last check is the important one and the reason this is cheap to trust: a
 * scope is wrong by construction if it rejects the very titles the candidate
 * said they were looking for. That catches an inverted headTerms list, an
 * over-eager exclusion, and a bareHeadIsCore mistake — the three failure modes
 * that would otherwise show up as "search returns nothing" days later.
 */
export function validateDerivedScope(
  scope: RoleScope,
  statedRoleFamilies: string[]
): { ok: true; warnings: string[] } | { ok: false; error: string } {
  if (scope.headTerms.length === 0) {
    return { ok: false, error: "headTerms is empty — every title would be rejected." };
  }

  // A term in both lists rejects everything; it is never a legitimate choice.
  const contradictions = scope.headTerms.filter((h) => scope.disqualifyingDomains.includes(h));
  if (contradictions.length > 0) {
    return {
      ok: false,
      error: `these terms are in both headTerms and disqualifyingDomains, which rejects every title: ${contradictions.join(", ")}`,
    };
  }
  const coreContradictions = scope.coreDomains.filter((c) => scope.disqualifyingDomains.includes(c));
  if (coreContradictions.length > 0) {
    return {
      ok: false,
      error: `these terms are in both coreDomains and disqualifyingDomains: ${coreContradictions.join(", ")}`,
    };
  }

  if (scope.rescuePhrases.length > 0 && scope.excludedDomains.length === 0) {
    return { ok: false, error: "rescuePhrases set with no excludedDomains to rescue from." };
  }

  if (!scope.rubricRules.trim()) {
    return { ok: false, error: "rubricRules is empty — the scorer would get no candidate-specific guidance." };
  }

  // The self-check: the candidate's own stated targets must survive their scope.
  const rejected = statedRoleFamilies.filter((t) => {
    if (!t.trim()) return false;
    return (
      classifyRoleFamily(t, scope) === null ||
      isOverSeniorTitle(t, scope) ||
      isUnderLeveledTitle(t, scope)
    );
  });
  if (rejected.length > 0 && rejected.length === statedRoleFamilies.filter((t) => t.trim()).length) {
    return {
      ok: false,
      error: `the generated scope rejects EVERY role family the candidate named (${rejected.slice(0, 4).join("; ")}). The lists are inverted or the exclusions are too broad.`,
    };
  }

  const warnings: string[] = [];
  if (rejected.length > 0) {
    warnings.push(
      `rejects ${rejected.length} of ${statedRoleFamilies.length} stated role families: ${rejected.join("; ")}. Check headTerms and disqualifyingDomains cover these, or drop them from roleFamilies if they were aspirational.`
    );
  }
  if (scope.disqualifyingDomains.length === 0) {
    warnings.push("no disqualifyingDomains — expect noise from other professions sharing the head noun.");
  }
  if (scope.bareHeadIsCore && scope.headTerms.some((h) => ["operations", "ops", "program", "project", "manager"].includes(h))) {
    warnings.push(
      `bareHeadIsCore is true with a generic head term (${scope.headTerms.join(", ")}) — every profession has one of these, so expect over-inclusion. Consider false plus domain qualifiers.`
    );
  }
  return { ok: true, warnings };
}

/**
 * Builds a scope from the candidate's stated intent. Returns an error rather
 * than a guess when the model is unavailable or its output can't be trusted —
 * a wrong scope silently returns zero search results, which is worse than
 * failing loudly at setup.
 */
export async function deriveRoleScope(input: ScopeDerivationInput): Promise<ScopeDerivationResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not set — scope derivation needs it." };
  }
  const stated = input.roleFamilies.filter((r) => r.trim());
  if (stated.length === 0 && !input.targetStatement?.trim()) {
    return {
      ok: false,
      error:
        "nothing to derive from: set searchCriteria.roleFamilies and/or searchCriteria.targetStatement in your profile first.",
    };
  }

  const userMessage = [
    `ROLE FAMILIES THE CANDIDATE IS TARGETING:\n${stated.map((r) => `- ${r}`).join("\n") || "(none given)"}`,
    input.functionTags?.length ? `FUNCTION TAGS:\n${input.functionTags.join(", ")}` : "",
    input.targetStatement?.trim()
      ? `IN THEIR OWN WORDS:\n${input.targetStatement.trim()}`
      : "",
    `WORKED EXAMPLES of the output shape — do not copy their vocabulary, only their structure:\n\nOperations (bareHeadIsCore FALSE, because bare "Operations Manager" is noise):\n${JSON.stringify({ headTerms: OPS_ROLE_SCOPE.headTerms, bareHeadIsCore: false, coreDomains: OPS_ROLE_SCOPE.coreDomains.slice(0, 6), overSeniorTerms: OPS_ROLE_SCOPE.overSeniorTerms }, null, 2)}\n\nProduct (bareHeadIsCore TRUE, and note "principal" is absent from overSeniorTerms because Principal PM is a senior IC title):\n${JSON.stringify({ headTerms: PRODUCT_ROLE_SCOPE.headTerms, bareHeadIsCore: true, coreDomains: PRODUCT_ROLE_SCOPE.coreDomains.slice(0, 6), overSeniorTerms: PRODUCT_ROLE_SCOPE.overSeniorTerms }, null, 2)}`,
    `Produce the scope for THIS candidate. It must accept the role families listed above — that is checked in code, and a scope that rejects them is discarded.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
    });
  } catch (err) {
    return { ok: false, error: `Claude call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  await logAnthropicUsage({ callSite: "role_scope", model: MODEL, response });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (toolUse?.type !== "tool_use") {
    return { ok: false, error: "model did not return a scope." };
  }
  const raw = toolUse.input as Record<string, unknown>;

  const scope: RoleScope = {
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : "Derived scope",
    headTerms: strings(raw.headTerms),
    secondaryHeadTerms: strings(raw.secondaryHeadTerms),
    bareHeadIsCore: raw.bareHeadIsCore === true,
    coreDomains: strings(raw.coreDomains),
    adjacentDomains: strings(raw.adjacentDomains),
    disqualifyingDomains: strings(raw.disqualifyingDomains),
    conditionalDomains: strings(raw.conditionalDomains),
    excludedDomains: strings(raw.excludedDomains),
    rescuePhrases: strings(raw.rescuePhrases),
    overSeniorTerms: strings(raw.overSeniorTerms),
    underLeveledTerms: strings(raw.underLeveledTerms),
    rubricRules: typeof raw.rubricRules === "string" ? raw.rubricRules.trim() : "",
  };

  const check = validateDerivedScope(scope, stated);
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true, scope, warnings: check.warnings };
}
