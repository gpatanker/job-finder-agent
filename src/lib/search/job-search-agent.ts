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
const OVER_SENIOR_TITLE_REGEX =
  /\b(director|head of|vice president|\bvp\b|\bsvp\b|\bevp\b|principal)\b/i;

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
    lastRunDate: params.lastRunDate,
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
- Higher for: title closely matching the BizOps/Strategy & Ops/GTM Ops/RevOps/Technical Ops family; the role's actual duties involving operations/process ownership, cross-functional coordination, data-driven reporting, or GTM/revenue ops work; location in the candidate's stated metros or explicitly remote-US; salary (if listed) at or above the candidate's stated floor.
- Lower for: pure customer-support IC roles, pure quota-carrying sales roles, or roles requiring deep hands-on software engineering the candidate's background doesn't support.
- ADJACENT-BUT-DIFFERENT OPERATIONS SPECIALIZATIONS are NOT this candidate's function and must score low (below 40) no matter how senior or well-matched the rest of the posting looks. The word "Operations" in a title is not evidence of fit on its own — the qualifier in front of it is what matters. Specifically excluded: Recruiting/Talent Ops, HR/People Ops, Payroll/Benefits/Compensation Ops, Warehouse/Logistics/Supply Chain/Fulfillment/Inventory Ops, Procurement/Strategic Sourcing/Commodity Management, IT Ops/Helpdesk/NOC/Security Ops, Customer Support/Contact Center Ops, Clinical/Healthcare Ops, Billing/Treasury/Collections/Claims Ops, Content/Community/Trust & Safety Ops, Facilities/Workplace Ops, and Manufacturing/Field/Fleet Ops. Real cases the candidate dismissed after this rubric scored them 74-82: "OpenAI — Strategic Sourcing Manager, Compute", "Google — GPU Commodity Manager, Global Strategic Sourcing and Silicon Operations", "Lambda — Procurement & Operations Lead". A supply-chain or support-flavored title is only in scope when it is explicitly framed as a business/strategy role (e.g. "Strategy & Operations Manager, Supply").
- FINANCE and MARKETING are hard exclusions — score below 40 — even when the title also names Business Operations, Strategy, or GTM in the same breath. Confirmed 2026-07-28: the candidate does not want any Finance-titled or Marketing-titled role, full stop, regardless of what else is in the title. This is a stronger rule than the general "adjacent domain only excluded on its own" pattern above — do not let "Business Operations" or "Strategy" in the same title override it. Real examples that must score below 40 under this rule: "Strategic Finance - Business Operations Lead", "Manager, Strategic Finance & Business Operations", "Sr. Manager, Growth Marketing Operations", "FP&A Manager, Business Operations".
- CORPORATE DEVELOPMENT / M&A is a hard exclusion — score below 40 — even when the title also names Operations, Business, or Strategy. It is a distinct deal-sourcing and integration specialization the candidate has zero experience in, not a flavor of BizOps, and "Corporate" is not a qualifying domain word here. Confirmed 2026-07-28 real example: "Corporate Development Operation & M&A Integration Lead" (Snowflake). "Product Strategy and Corporate Development Lead" is excluded on the same basis.
- QUOTA-CARRYING AND CUSTOMER-FACING SALES IC ROLES are a hard exclusion — score below 40 — even when paired with "Strategic", "Commercial", "Enterprise", or a named vertical. This covers Account Executive, Account Manager, Sales Manager / Manager of AEs, Sales Development Representative (SDR) and Business Development Representative (BDR), Strategic/Enterprise Customer Success Manager, and Strategic Partner/Partnerships Manager roles that are really relationship-ownership jobs. Note "Sales Operations" / "Revenue Operations" / "Partner Operations" remain fully in scope — the exclusion is the selling/account-owning role, not the ops function behind it. Confirmed 2026-07-28 real examples that must score below 40: "Strategic Account Executive, Retail & Commercial Banking - FSI" (Anthropic), "Manager, Account Executive - Strategic Sales" (Anthropic), "Strategic Account Executive, New Vertical Sales" (Flex), "Sales Manager, Strategic Accounts" (Ripple), "Strategic Sales Development Representative, Robotics & Automotive" (Scale AI).
- HANDS-ON ENGINEERING AND TECHNICAL IC ROLES are a hard exclusion — score below 40 — for any title containing "Engineer" (as in "...Engineer" job titles — not the broader "Engineering" as a modifier, which can legitimately describe a BizOps-for-the-engineering-org role), even when it also names Operations, Infrastructure, Data Center, or Strategic Partnerships. The candidate is explicit that pure engineering does not align with his background. This is stronger than the general software-engineering line above, because these titles are not obviously software roles and kept scoring in the 60s-70s on the strength of their "Operations" qualifier. Confirmed 2026-07-28 real examples: "Sales Systems Engineer, Enterprise Operations" (Perplexity), "Global Operations Engineer (Product & Change Management)" (SpaceX), "Infrastructure Engineer (Data Center Operations)" (Cerebras), "Quality Engineer - Rack Infrastructure & Site Operations - Stargate" (OpenAI), "AI Field Engineer - Strategic Partnerships" (Fireworks AI), "Data Center Operations Systems Engineer" (Lambda). Also excluded on the same hands-on-technical-IC basis: "Network Operator, Data Center Operations" (Fluidstack). What stays IN scope: non-engineer-titled roles in the same domains — "Infrastructure Operations", "AI Infrastructure Operations", "Technical Program Manager", and a title like "Engineering Strategy & Operations Manager" are the candidate's own role families and target titles, not excluded by this rule.
- Do NOT adjust the score based on the company's industry — a Business Operations Manager role scores the same whether the company is in AI infrastructure, insurance, gaming, fintech, or government, as long as the role/function itself fits. Industry is only used earlier to help find candidates, never to score them.
- Reserve 85+ for postings where the title is a direct core-family match AND the material actually evidences the duties/level/location fit — not for a title that merely sounds senior. Spread the rest across the range rather than clustering; a score that doesn't distinguish a strong fit from a passable one is useless to the candidate.

SENIORITY CEILING — the candidate's reach tops out at Senior Manager. Do NOT include Director, Senior Director, Associate Director, Head of, VP/Vice President, SVP, EVP, Chief-of-staff-as-a-title, or any more senior title, even if everything else about the role is a strong match. PRINCIPAL-titled roles are also out of reach — confirmed 2026-07-28 after the candidate rejected "Principal, Strategic Partnerships (Health Systems)" (Assort Health) and "Principal Electrical Operations Lead — Data Center Operations" (Fluidstack) as too senior for him. Exclude "Principal" anywhere in the title, whether it's the whole level ("Principal, Business Operations") or a modifier on the function ("Principal Operations Lead"). Manager, Senior Manager, Lead, and Staff-level titles are still fair game — the line is now Principal-and-above, not Director-and-above.

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
    .filter((c) => !isOverSeniorTitle(c.title))
    .map((c) => ({
      ...c,
      matchScore: Math.max(0, Math.min(100, Math.round(Number(c.matchScore) || 0))),
    }));

  return { candidates, warning: discovery.warning };
}
