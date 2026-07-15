import Anthropic from "@anthropic-ai/sdk";
import type { CandidateProfile } from "@/lib/db/schema";

const MODEL = "claude-sonnet-5";
const TOOL_NAME = "submit_job_candidates";

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

/**
 * Job Search Agent: the one genuinely agentic (tool-calling) piece in this
 * app. Claude searches the web (a native server-side tool — Anthropic's API
 * executes the search itself) for currently-open postings matching the
 * candidate's criteria, then must call submit_job_candidates with only what
 * it actually found. Results are NOT written to the jobs table directly —
 * the caller stores them as suggestions requiring human "Promote" action,
 * since a web-search-backed model can surface stale or wrong postings.
 */
export async function findJobCandidates(params: {
  profile: CandidateProfile;
  knownJobs: { company: string; title: string }[];
}): Promise<{ candidates: JobCandidate[]; warning?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      candidates: [],
      warning: "ANTHROPIC_API_KEY is not set — job search requires it.",
    };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const criteria = params.profile.searchCriteria;
  const knownList = params.knownJobs
    .slice(0, 100)
    .map((j) => `${j.company} — ${j.title}`)
    .join("\n");

  const systemPrompt = `You are a job-search assistant helping a real candidate find currently-open roles. You have a native web_search tool — use it to find actual, currently-open job postings, not ones you recall from training data.

Rules:
- Only include postings you actually found via web_search in this conversation, with a real applyUrl/sourceUrl from the search results. Never fabricate a posting or guess a URL.
- applyUrl MUST be a deep link directly to that specific posting (a Greenhouse/Ashby/Lever URL with a job ID, or a company career-site URL with a role-specific slug) — NEVER a generic careers/jobs landing page (e.g. "company.com/careers" or "company.com/join-us" with nothing after it). If you can't find the specific posting's direct link, search more specifically (e.g. "site:job-boards.greenhouse.io <company>" or "<company> <title> greenhouse") before giving up — if you still can't find a direct link, don't include that candidate.
- Only source postings from the company's own careers page, or from these reputable platforms: Greenhouse, Ashby, Lever, Indeed, Wellfound, Handshake, JuiceBox, Monster, or other similarly well-established, mainstream job boards. Do not use unfamiliar scraped-listing aggregators or mirror sites (e.g. dealhub-style "revpath" sites) — these frequently keep mirroring listings long after the original has closed, which is unreliable for a real candidate.
- Never use TheLadders, ZipRecruiter, BuiltIn (including its regional sites, e.g. BuiltIn SF/NYC/Chicago), or Welcome to the Jungle — all excluded (paywall/quality issues; TheLadders specifically routes "Apply" to a $29.97+/month "Apply4Me" membership paywall instead of the employer's own application page). More generally: never use a platform that gates the actual application behind a paywall or paid membership. The candidate must always be able to reach the employer's real, free application from applyUrl. If a platform tries to charge to apply, search for the employer's own posting instead.
- If a search result's page indicates the posting is closed, filled, or expired (e.g. "no longer accepting applications", "position is probably filled"), skip it — do not include it.
- Prioritize the candidate's stated role families, locations, salary floor, and preferred industries.
- Skip anything already in the candidate's known-jobs list below (avoid near-duplicates by company+title).
- Do not tailor everything to any single company — search broadly across the stated preferred industries.
- Aim for 5-8 solid candidates. Fewer good matches is better than padding with irrelevant ones.
- When you are done searching, you MUST call ${TOOL_NAME} with your findings — do not just respond with text.`;

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

Search the web for currently-open postings matching this profile, then submit your findings.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 8 },
      submitTool,
    ],
  });

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
    .map((c) => ({
      ...c,
      matchScore: Math.max(0, Math.min(100, Math.round(Number(c.matchScore) || 0))),
    }));

  return { candidates };
}
