import Anthropic from "@anthropic-ai/sdk";
import type { CandidateProfile } from "@/lib/db/schema";
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
 */
const OVER_SENIOR_TITLE_REGEX = /\b(director|head of|vice president|\bvp\b|\bsvp\b|\bevp\b)\b/i;

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

export function isOverSeniorTitle(title: string): boolean {
  return OVER_SENIOR_TITLE_REGEX.test(title);
}

export function computeOverrepresentedCompanies(knownJobs: { company: string; title: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const j of knownJobs) {
    const key = j.company.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= OVERREPRESENTED_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([company, count]) => `${company} (${count} prior suggestions)`);
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
 * buildDiscoveryQueries firing several distinct Perplexity requests in
 * parallel (role synonyms, adjacent industries, direct ATS postings) rather
 * than from one model deciding to branch out mid-conversation — with
 * companies already heavily represented in this candidate's history
 * explicitly deprioritized in each query so the agent doesn't keep
 * re-mining the same handful of names.
 */
export async function findJobCandidates(params: {
  profile: CandidateProfile;
  knownJobs: { company: string; title: string }[];
  broaden?: boolean;
}): Promise<{ candidates: JobCandidate[]; warning?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      candidates: [],
      warning: "ANTHROPIC_API_KEY is not set — job search requires it.",
    };
  }

  const overrepresented = computeOverrepresentedCompanies(params.knownJobs);

  const discovery = await discoverCandidatePostings({
    profile: params.profile,
    overrepresentedCompanies: overrepresented,
    broaden: params.broaden,
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
- Higher for: title closely matching the BizOps/Strategy & Ops/GTM Ops/RevOps/Technical Ops family; the role's actual duties involving operations/process ownership, cross-functional coordination, data-driven reporting, or vendor/GTM ops work; location in the candidate's stated metros or explicitly remote-US; salary (if listed) at or above the candidate's stated floor.
- Lower for: pure customer-support IC roles, pure quota-carrying sales roles, pure finance/accounting-only roles, or roles requiring deep hands-on software engineering the candidate's background doesn't support.
- Do NOT adjust the score based on the company's industry — a Business Operations Manager role scores the same whether the company is in AI infrastructure, insurance, gaming, fintech, or government, as long as the role/function itself fits. Industry is only used earlier to help find candidates, never to score them.

SENIORITY CEILING — the candidate's reach tops out at Senior Manager. Do NOT include Director, Senior Director, Associate Director, Head of, VP/Vice President, SVP, EVP, Chief-of-staff-as-a-title, or any more senior title, even if everything else about the role is a strong match. Manager, Senior Manager, Lead, Principal, and Staff-level titles are all fair game — it's specifically Director-and-above that's out of reach.

Rules:
- Only include postings actually present in the discovery material below, with a real applyUrl/sourceUrl drawn from it. Never fabricate a posting or guess a URL — if the material doesn't include a specific posting's direct link, don't include that candidate.
- applyUrl MUST be a deep link directly to that specific posting (a Greenhouse/Ashby/Lever URL with a job ID, or a company career-site URL with a role-specific slug) — NEVER a generic careers/jobs landing page (e.g. "company.com/careers" or "company.com/join-us" with nothing after it). If the material doesn't give a specific-enough link for a mentioned posting, don't include that candidate.
- Only source postings from the company's own careers page, or from these reputable platforms: Greenhouse, Ashby, Lever, Indeed, Wellfound, Handshake, JuiceBox, Monster, or other similarly well-established, mainstream job boards. Do not use unfamiliar scraped-listing aggregators or mirror sites (e.g. dealhub-style "revpath" sites) — these frequently keep mirroring listings long after the original has closed, which is unreliable for a real candidate.
- Never use TheLadders, ZipRecruiter, BuiltIn (including its regional sites, e.g. BuiltIn SF/NYC/Chicago), or Welcome to the Jungle — all excluded (paywall/quality issues; TheLadders specifically routes "Apply" to a $29.97+/month "Apply4Me" membership paywall instead of the employer's own application page). More generally: never use a platform that gates the actual application behind a paywall or paid membership. The candidate must always be able to reach the employer's real, free application from applyUrl.
- If the discovery material indicates a posting is closed, filled, or expired (e.g. "no longer accepting applications", "position is probably filled"), skip it — do not include it.
- Prefer the company's own careers/ATS page over a third-party aggregator's copy of the same listing when the material gives you both, since aggregators keep mirroring a posting long after the original closes.
- Skip anything already in the candidate's known-jobs list below (avoid near-duplicates by company+title) — this list covers the candidate's full suggestion history, not just recent runs.
- Extract and score every clearly-qualified, distinct posting actually present in the material — don't artificially cap yourself at a small number, but don't pad with irrelevant or duplicate ones either.
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
    .filter((c) => !isOverSeniorTitle(c.title))
    .map((c) => ({
      ...c,
      matchScore: Math.max(0, Math.min(100, Math.round(Number(c.matchScore) || 0))),
    }));

  return { candidates, warning: discovery.warning };
}
