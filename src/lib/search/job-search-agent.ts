import Anthropic from "@anthropic-ai/sdk";
import type { CandidateProfile } from "@/lib/db/schema";

const MODEL = "claude-sonnet-5";
const TOOL_NAME = "submit_job_candidates";
const MAX_WEB_SEARCHES = 25;
const OVERREPRESENTED_THRESHOLD = 3;

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
 * Job Search Agent: the one genuinely agentic (tool-calling) piece in this
 * app. Claude searches the web (a native server-side tool — Anthropic's API
 * executes the search itself) for currently-open postings matching the
 * candidate's criteria, then must call submit_job_candidates with only what
 * it actually found. Results are NOT written to the jobs table directly —
 * the caller stores them as suggestions requiring human "Promote" action,
 * since a web-search-backed model can surface stale or wrong postings.
 *
 * Real problem this addresses: repeated runs kept resurfacing the same
 * narrow slice of famous AI-lab names (18 distinct companies across 53
 * suggestions total) because the prompt only asked for "5-8 candidates" in
 * the stated industries without pushing the agent to branch into adjacent
 * ones or explicit query variety. The strategy below asks for a genuinely
 * wide net (varied role synonyms, locations, platforms, and adjacent
 * industries) searched broadly first, then scored/ranked down to the
 * strongest matches — with companies already heavily represented in this
 * candidate's history explicitly deprioritized so the agent doesn't keep
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

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const criteria = params.profile.searchCriteria;
  const knownList = params.knownJobs
    .slice(0, 200)
    .map((j) => `${j.company} — ${j.title}`)
    .join("\n");
  const overrepresented = computeOverrepresentedCompanies(params.knownJobs);

  const systemPrompt = `You are a job-search assistant helping a real candidate find currently-open roles. You have a native web_search tool — use it to find actual, currently-open job postings, not ones you recall from training data.

SEARCH STRATEGY — search broad first, then score and rank narrow. Do not conclude the market is exhausted just because a narrow slice of famous names is picked over:
1. Systematically vary your queries — don't just search the exact stated role title and industry and stop. Branch across:
   - The candidate's stated role families AND close synonyms (e.g. also try "Operations Manager", "Strategy & Operations Manager", "Revenue Operations Manager", "Technical Operations Manager", "Business Operations Analyst", "Strategy Associate", "Support Operations Manager", "Customer Operations Strategy").
   - The candidate's stated locations, plus "remote US".
   - Multiple sources: try queries like "<role> <location> Greenhouse", "<role> <location> Ashby", "<role> <location> Lever", "<role> remote US startup", in addition to plain searches, and check individual company career pages when a specific company seems promising.
   - The candidate's stated industries AND adjacent ones — general cloud infrastructure, developer tools, data infrastructure, cybersecurity, robotics, hardware/semiconductor, fintech infrastructure, logistics/IoT, energy/climate tech, and vertical SaaS companies with technical operations teams — not only the exact industries listed, which tend to converge on the same famous handful of AI labs every time.
2. Cast a wide net first, then use the scoring rubric below to rank and keep only the strongest matches. If your early searches keep returning the same companies, that's a signal to deliberately branch into the adjacent industries/role synonyms above, not a signal to stop.
${overrepresented.length > 0 ? `3. These companies are already heavily represented in this candidate's suggestion history — deprioritize searching for more roles at them; only include one if it's an exceptionally strong, clearly distinct match:\n${overrepresented.map((c) => `   - ${c}`).join("\n")}` : ""}
${params.broaden ? "\nIMPORTANT: An earlier pass this run already searched the core criteria and came back thin. This is a follow-up broadening pass — deliberately prioritize the adjacent industries, role synonyms, and companies NOT already in the known-jobs list below, even if they're a slightly less obvious fit than the primary criteria." : ""}

SCORING RUBRIC for matchScore (0-100) — apply consistently:
- Higher for: title closely matching the BizOps/Strategy & Ops/GTM Ops/RevOps/Technical Ops family; work involving technical or infrastructure operations, cloud, AI, data, support ops, or GTM ops; location in the candidate's stated metros or explicitly remote-US; salary (if listed) at or above the candidate's stated floor.
- Lower for: pure customer-support IC roles, pure quota-carrying sales roles, pure finance/accounting roles, or roles requiring deep hands-on software engineering the candidate's background doesn't support.

Rules:
- Only include postings you actually found via web_search in this conversation, with a real applyUrl/sourceUrl from the search results. Never fabricate a posting or guess a URL.
- applyUrl MUST be a deep link directly to that specific posting (a Greenhouse/Ashby/Lever URL with a job ID, or a company career-site URL with a role-specific slug) — NEVER a generic careers/jobs landing page (e.g. "company.com/careers" or "company.com/join-us" with nothing after it). If you can't find the specific posting's direct link, search more specifically (e.g. "site:job-boards.greenhouse.io <company>" or "<company> <title> greenhouse") before giving up — if you still can't find a direct link, don't include that candidate.
- Only source postings from the company's own careers page, or from these reputable platforms: Greenhouse, Ashby, Lever, Indeed, Wellfound, Handshake, JuiceBox, Monster, or other similarly well-established, mainstream job boards. Do not use unfamiliar scraped-listing aggregators or mirror sites (e.g. dealhub-style "revpath" sites) — these frequently keep mirroring listings long after the original has closed, which is unreliable for a real candidate.
- Never use TheLadders, ZipRecruiter, BuiltIn (including its regional sites, e.g. BuiltIn SF/NYC/Chicago), or Welcome to the Jungle — all excluded (paywall/quality issues; TheLadders specifically routes "Apply" to a $29.97+/month "Apply4Me" membership paywall instead of the employer's own application page). More generally: never use a platform that gates the actual application behind a paywall or paid membership. The candidate must always be able to reach the employer's real, free application from applyUrl. If a platform tries to charge to apply, search for the employer's own posting instead.
- If a search result's page indicates the posting is closed, filled, or expired (e.g. "no longer accepting applications", "position is probably filled"), skip it — do not include it.
- Prefer roles that appear recently posted/updated where you can tell; if you can't determine recency, still include it rather than excluding on that basis alone.
- Skip anything already in the candidate's known-jobs list below (avoid near-duplicates by company+title) — this list covers the candidate's full suggestion history, not just recent runs.
- Aim for 10-20 solid candidates by casting a genuinely wide net per the strategy above, then narrowing via the scoring rubric — fewer good matches is better than padding with irrelevant ones, but don't stop at 1-2 just because the first couple of queries returned familiar names.
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
      { type: "web_search_20250305", name: "web_search", max_uses: MAX_WEB_SEARCHES },
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
