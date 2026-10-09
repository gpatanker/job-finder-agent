import Anthropic from "@anthropic-ai/sdk";
import type { CandidateProfile } from "@/lib/db/schema";
import { OPS_ROLE_SCOPE, type RoleScope } from "./role-scope";
import { discoverCandidatePostings } from "./perplexity-discover";
import { logAnthropicUsage } from "@/lib/observability/llm-usage";

// Structuring/scoring model for the bounded call below. Swap to
// "claude-opus-4-8" to trial Opus on this specific judgment-heavy step (it's
// a known weak point — see OVER_SENIOR_TITLE_REGEX's comment) — it's 2.5x
// Sonnet 5's per-token rate, but since this is now a single bounded call
// (not 12 rounds of accumulating web_search context), that cost doesn't
// compound the way it used to. Compare wasted-candidate rate on a same-input
// side-by-side before committing.
const MODEL = "claude-sonnet-5";
const TOOL_NAME = "submit_job_candidates";
const OVERREPRESENTED_THRESHOLD = 3;

/**
 * The candidate's actual reach tops out at Senior Manager — confirmed live
 * (2026-07-17) after the search kept surfacing Director/Head of/VP titles
 * (e.g. "Airwallex — Director, Revenue Strategy & Operations", "OpenFX —
 * Head of Business Operations") the candidate isn't qualified for. This is
 * a deterministic backstop on top of the prompt instruction below, since
 * the model doesn't always honor a seniority ceiling reliably.
 *
 * "principal" added 2026-07-28: the candidate confirmed it is above his
 * ceiling too, after two real suggestions — "Principal, Strategic
 * Partnerships (Health Systems)" (Assort Health) and "Principal Electrical
 * Operations Lead — Data Center Operations" (Fluidstack). \b keeps it from
 * firing inside a longer word, and "principle" (the unrelated homophone) is
 * a different string, so there is no substring collision to worry about.
 *
 * Reused by the free direct-board-poll channel as well —
 * known-company-boards.ts imports isOverSeniorTitle and applies it as a hard
 * reject before scoring, so a change here fixes both discovery channels.
 */

export type JobCandidate = {
  company: string;
  title: string;
  location?: string;
  workMode?: string;
  applyUrl: string;
  sourceUrl: string;
  salaryText?: string;
  matchScore: number;
  rationale: string;
};

const submitTool = {
  name: TOOL_NAME,
  description:
    "Submit the list of currently-open job posting candidates found via web search.",
  input_schema: {
    type: "object" as const,
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            company: { type: "string" },
            title: { type: "string" },
            location: { type: "string" },
            workMode: { type: "string", enum: ["remote", "hybrid", "onsite"] },
            applyUrl: {
              type: "string",
              description: "Direct link to the job posting/application page, from actual search results — never guessed.",
            },
            sourceUrl: {
              type: "string",
              description: "The URL where this posting was actually found.",
            },
            salaryText: { type: "string" },
            matchScore: {
              type: "integer",
              description: "0-100 fit score against the candidate's background and search criteria.",
            },
            rationale: {
              type: "string",
              description: "1-2 sentence explanation of the fit, grounded in the candidate's real background.",
            },
          },
          required: ["company", "title", "applyUrl", "sourceUrl", "matchScore", "rationale"],
        },
      },
    },
    required: ["candidates"],
  },
};

export function isOverSeniorTitle(
  title: string,
  scope: RoleScope = OPS_ROLE_SCOPE
): boolean {
  return wholeWordRegex(scope.overSeniorTerms).test(title);
}

/**
 * The floor that OVER_SENIOR_TITLE_REGEX never had a counterpart for. The
 * candidate is a business/strategy operator, not a hands-on facilities,
 * hardware, or field IC — but classifyRoleFamily only ever checked the
 * ceiling, so an under-leveled title carrying a legitimate ops word sailed
 * through on domain match alone.
 *
 * Confirmed 2026-08-26: "Associate Data Center Operations Technician"
 * (xAI, Memphis TN) surfaced at score 54 because the title matched
 * "operations" plus the "data center" ADJACENT_DOMAINS entry — an entry
 * that has to stay, since "Infrastructure Operations" and "AI Infrastructure
 * Operations" are the candidate's own stated role families. The domain is
 * right; the level and the hands-on nature of the work are not. The
 * candidate's own words: "data center Ops technician are not roles that
 * align with what I do."
 *
 * Deliberately narrow. Only titles naming a manual/technical trade or an
 * explicitly pre-professional level are listed, so a management title in the
 * same domain ("Data Center Operations Lead", "Infrastructure Operations
 * Manager") is untouched. \b prevents "intern" from firing inside
 * "internal", which is a real word in ops titles.
 */

export function isUnderLeveledTitle(
  title: string,
  scope: RoleScope = OPS_ROLE_SCOPE
): boolean {
  return wholeWordRegex(scope.underLeveledTerms).test(title);
}

/**
 * Builds a whole-word, case-insensitive alternation from a scope's word list.
 * \b matters: it keeps "intern" from firing inside "internal", which is a real
 * word in ops titles, and keeps "vp" from firing inside "vped".
 */
function wholeWordRegex(terms: readonly string[]): RegExp {
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
}

function countByCompany(knownJobs: { company: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const j of knownJobs) {
    const key = j.company.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function computeOverrepresentedCompanies(knownJobs: { company: string; title: string }[]): string[] {
  return [...countByCompany(knownJobs).entries()]
    .filter(([, count]) => count >= OVERREPRESENTED_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([company, count]) => `${company} (${count} prior suggestions)`);
}

/**
 * Same threshold as computeOverrepresentedCompanies, but as raw company names
 * rather than prompt-facing labels.
 *
 * The formatted version only ever reaches the Claude prompt, so it can only
 * influence the Perplexity+Claude channel. Board polling
 * (discoverFromKnownCompanyBoards) builds candidates directly and never sees
 * that prompt, which left the only anti-concentration guard structurally
 * unable to touch it. Measured over 2026-08-11..20: board polling produced 46
 * of 76 suggestions and every single cross-day repeat company — Anthropic 7/7
 * from boards, Anduril 6/6, DoorDash 3/3. This export is what lets the board
 * channel apply the same rule.
 */
export function computeOverrepresentedCompanyNames(
  knownJobs: { company: string }[],
  threshold: number = OVERREPRESENTED_THRESHOLD
): Set<string> {
  return new Set(
    [...countByCompany(knownJobs).entries()]
      .filter(([, count]) => count >= threshold)
      .map(([company]) => company)
  );
}

/**
 * Job Search Agent, now a two-step pipeline instead of one long agentic
 * conversation:
 *   1. discoverCandidatePostings() (Perplexity Sonar, several parallel
 *      queries) does the broad web discovery — cheap, and each request is
 *      independently bounded, so there's no compounding multi-turn cost.
 *   2. One bounded Claude call structures/dedupes/scores whatever Perplexity
 *      found into JobCandidate objects, applying the same scoring rubric,
 *      seniority ceiling, and URL-legitimacy rules this function always
 *      enforced — it just no longer drives the search itself.
 * Results are NOT written to the jobs table directly — the caller stores
 * them as suggestions requiring human "Promote" action, since a
 * search-backed model can still surface stale or wrong postings.
 *
 * Real problem this addresses: repeated runs kept resurfacing the same
 * narrow slice of famous AI-lab names (18 distinct companies across 53
 * suggestions total) because the prompt only asked for "5-8 candidates" in
 * the stated industries without pushing the agent to branch into adjacent
 * ones or explicit query variety. Query variety now comes from
 * buildDiscoveryQueries firing several distinct, rotating Perplexity
 * requests in parallel (role synonyms, adjacent industries, direct ATS
 * postings) rather than from one model deciding to branch out
 * mid-conversation. Companies already heavily represented in this
 * candidate's history are surfaced to the STRUCTURING step below (not baked
 * into the search query text) — a 2026-07-27 measurement found appending an
 * "avoid these companies" instruction to the Perplexity query text was a
 * complete no-op at retrieval (identical results with/without it, since
 * /search is ranked retrieval, not an instruction-follower) while eating
 * 58-74% of every query's character budget. Claude, unlike the search
 * endpoint, actually follows instructions, so this is the step where that
 * guidance can do something.
 */
export async function findJobCandidates(params: {
  profile: CandidateProfile;
  knownJobs: { company: string; title: string }[];
  lastRunDate?: Date | null;
  broaden?: boolean;
  /**
   * Supplies the candidate-specific half of the scoring rubric and the
   * seniority band. Defaults to the original operations scope, so an instance
   * that sets none gets a byte-identical prompt to before this was factored out.
   */
  roleScope?: RoleScope;
}): Promise<{ candidates: JobCandidate[]; warning?: string }> {
  const scope = params.roleScope ?? OPS_ROLE_SCOPE;
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      candidates: [],
      warning: "ANTHROPIC_API_KEY is not set — job search requires it.",
    };
  }

  const overrepresented = computeOverrepresentedCompanies(params.knownJobs);

  const discovery = await discoverCandidatePostings({
    profile: params.profile,
    lastRunDate: params.lastRunDate,
    broaden: params.broaden,
    roleScope: scope,
  });

  if (!discovery.combinedText) {
    return {
      candidates: [],
      warning: discovery.warning ?? "Discovery step returned no material to structure.",
    };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const criteria = params.profile.searchCriteria;
  const knownList = params.knownJobs
    .slice(0, 200)
    .map((j) => `${j.company} — ${j.title}`)
    .join("\n");

  const systemPrompt = `You are a job-search assistant helping a real candidate find currently-open roles. Web discovery has already been done for you (see DISCOVERY MATERIAL below) — your job is to extract, structure, dedupe, and score the postings actually present in it. Do not use anything you recall from training data instead of the material given.

SCORING RUBRIC for matchScore (0-100) — apply consistently, based only on role/function fit, not industry:
${scope.rubricRules}
- Do NOT adjust the score based on the company's industry — a Business Operations Manager role scores the same whether the company is in AI infrastructure, insurance, gaming, fintech, or government, as long as the role/function itself fits. Industry is only used earlier to help find candidates, never to score them.
- Reserve 85+ for postings where the title is a direct core-family match AND the material actually evidences the duties/level/location fit — not for a title that merely sounds senior. Spread the rest across the range rather than clustering; a score that doesn't distinguish a strong fit from a passable one is useless to the candidate.
Rules:
- Only include postings actually present in the discovery material below, with a real applyUrl/sourceUrl drawn from it. Never fabricate a posting or guess a URL — if the material doesn't include a specific posting's direct link, don't include that candidate.
- applyUrl MUST be a deep link directly to that specific posting (a Greenhouse/Ashby/Lever URL with a job ID, or a company career-site URL with a role-specific slug) — NEVER a generic careers/jobs landing page (e.g. "company.com/careers" or "company.com/join-us" with nothing after it). If the material doesn't give a specific-enough link for a mentioned posting, don't include that candidate.
- Only source postings from the company's own careers page, or from these reputable platforms: Greenhouse, Ashby, Lever, Indeed, Wellfound, Handshake, JuiceBox, Monster, or other similarly well-established, mainstream job boards. Do not use unfamiliar scraped-listing aggregators or mirror sites (e.g. dealhub-style "revpath" sites) — these frequently keep mirroring listings long after the original has closed, which is unreliable for a real candidate.
- Never use TheLadders, ZipRecruiter, BuiltIn (including its regional sites, e.g. BuiltIn SF/NYC/Chicago), or Welcome to the Jungle — all excluded (paywall/quality issues; TheLadders specifically routes "Apply" to a $29.97+/month "Apply4Me" membership paywall instead of the employer's own application page). More generally: never use a platform that gates the actual application behind a paywall or paid membership. The candidate must always be able to reach the employer's real, free application from applyUrl.
- If the discovery material indicates a posting is closed, filled, or expired (e.g. "no longer accepting applications", "position is probably filled"), skip it — do not include it.
- Prefer the company's own careers/ATS page over a third-party aggregator's copy of the same listing when the material gives you both, since aggregators keep mirroring a posting long after the original closes.
- Skip anything already in the candidate's known-jobs list below (avoid near-duplicates by company+title) — this list covers the candidate's full suggestion history, not just recent runs.
- Extract and score every clearly-qualified, distinct posting actually present in the material — don't artificially cap yourself at a small number, but don't pad with irrelevant or duplicate ones either.
- OVERREPRESENTED COMPANIES (see list below, if any): the candidate already has 3+ prior suggestions from these companies. Don't exclude them outright, but deprioritize — only include another posting from one of these if it's a meaningfully better fit (higher score) than a typical inclusion, so the result set doesn't keep re-mining the same handful of famous names at the expense of everything else in the discovery material.
- You MUST call ${TOOL_NAME} with your findings — do not just respond with text.`;

  const userMessage = `CANDIDATE BACKGROUND
- Current company: ${params.profile.currentCompany ?? "n/a"}
- Function: ${params.profile.functionTags.join(", ")}
- Preferred industries: ${params.profile.preferredIndustries.join(", ")}

SEARCH CRITERIA
- Role families: ${criteria?.roleFamilies?.join(", ") ?? "n/a"}
- Locations: ${criteria?.locations?.join(", ") ?? "n/a"}
- Salary floor: ${criteria?.salaryFloor ? `$${criteria.salaryFloor.toLocaleString()}` : "n/a"}
- Industries: ${criteria?.industries?.join(", ") ?? "n/a"}

ALREADY-KNOWN JOBS (skip near-duplicates of these)
${knownList || "(none yet)"}

OVERREPRESENTED COMPANIES (deprioritize per the scoring rules above)
${overrepresented.join("\n") || "(none)"}

DISCOVERY MATERIAL (from web search already performed — extract only what's actually here)
${discovery.combinedText}

CITATION URLS SEEN DURING DISCOVERY (for cross-checking applyUrl/sourceUrl legitimacy)
${discovery.citations.join("\n") || "(none)"}

Extract, dedupe, and score the candidates present in the discovery material, then submit your findings.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [submitTool],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });
  await logAnthropicUsage({ callSite: "job_search", model: MODEL, response });

  const toolUse = response.content.find(
    (c) => c.type === "tool_use" && c.name === TOOL_NAME
  );

  if (!toolUse || toolUse.type !== "tool_use") {
    return {
      candidates: [],
      warning: "The search agent didn't return structured results this time — try again.",
    };
  }

  const input = toolUse.input as { candidates?: unknown };
  if (!Array.isArray(input.candidates)) {
    return { candidates: [], warning: "Search agent returned no candidates." };
  }

  const candidates: JobCandidate[] = input.candidates
    .filter(
      (c): c is JobCandidate =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as JobCandidate).company === "string" &&
        typeof (c as JobCandidate).title === "string" &&
        typeof (c as JobCandidate).applyUrl === "string" &&
        typeof (c as JobCandidate).sourceUrl === "string"
    )
    .filter((c) => !isOverSeniorTitle(c.title, scope))
    .map((c) => ({
      ...c,
      matchScore: Math.max(0, Math.min(100, Math.round(Number(c.matchScore) || 0))),
    }));

  return { candidates, warning: discovery.warning };
}
