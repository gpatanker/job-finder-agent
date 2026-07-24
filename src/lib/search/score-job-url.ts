import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";
import type { CandidateProfile, ResumeData } from "@/lib/db/schema";
import { detectPlatform } from "@/lib/scraping";
import { fetchHtml } from "@/lib/scraping/types";
import { isBlockedSource } from "./blocked-sources";
import { looksLikeGenericCareersPage } from "./specificity-check";
import { textIndicatesClosedPosting, textMentionsTitle } from "./freshness-check";
import { detectEmbeddedGreenhouseBoard } from "./live-board";
import { logAnthropicUsage } from "@/lib/observability/llm-usage";

const MODEL = "claude-sonnet-5";
const TOOL_NAME = "submit_job_score";
const MAX_PAGE_TEXT = 20000;

export type JobScoreResult = {
  company: string;
  title: string;
  location: string | null;
  workMode: string | null;
  salaryText: string | null;
  matchScore: number;
  rationale: string;
};

// Claude occasionally fills an optional tool-input field with a literal
// placeholder ("<UNKNOWN>", "N/A", "unknown") instead of actually omitting
// it — treat those the same as genuinely absent, rather than displaying
// them as if they were real extracted values.
const PLACEHOLDER_VALUES = new Set(["", "unknown", "n/a", "na", "<unknown>", "none", "null"]);

function cleanOptionalField(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

export type ScoreJobUrlResult =
  | { ok: true; result: JobScoreResult }
  | { ok: false; error: string };

function labeledFields(fields: Record<string, string | undefined | null>): string {
  return Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

/** Ashby's page title reliably follows "{Job Title} @ {Company}" — confirmed live (e.g. "Business Operations @ Physical Intelligence") — and is present in the raw HTML even though the rest of the page is client-rendered. */
function companyFromTitleTag(html: string): string | undefined {
  const title = cheerio.load(html)("title").text().trim();
  const parts = title.split(/\s+@\s+/);
  return parts.length > 1 ? parts[parts.length - 1].trim() : undefined;
}

/**
 * Fetches one Greenhouse job's full detail (title/company/location/
 * description) directly by board token + job ID — shared by both the
 * direct job-boards.greenhouse.io link case and the embedded-widget case
 * below, since both end up needing the exact same lookup once the token
 * and ID are known.
 */
async function fetchGreenhouseJobText(boardToken: string, jobId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${jobId}`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; JobFinderAgent/1.0)" } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      company_name?: string;
      location?: { name?: string };
      content?: string;
    };
    const descriptionText = cheerio.load(data.content ?? "")("body").text().trim();
    const fields = labeledFields({
      Title: data.title,
      Company: data.company_name,
      Location: data.location?.name,
    });
    return [fields, descriptionText].filter(Boolean).join("\n\n").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Fetches a single job posting's readable content, preferring a platform's
 * public Job Board API when one exists — far more reliable than scraping,
 * since these return clean structured fields (location, work mode) as JSON
 * rather than requiring extraction from prose or, worse, a client-rendered
 * page a plain fetch can't see at all:
 *   - Greenhouse: boards-api.greenhouse.io (also used in scraping/greenhouse.ts),
 *     including companies that embed the widget on their own domain
 *   - Ashby: api.ashbyhq.com/posting-api — confirmed real case: a Physical
 *     Intelligence posting's Location ("San Francisco") was clearly visible
 *     on the page but missing from a plain-fetch/meta-description
 *     extraction, because Ashby renders those structured fields from
 *     client-side JSON, not page text. This API returns them directly.
 * Everything else falls back to a plain fetch + stripped-down visible body
 * text (with a meta-description fallback for SPA shells with an empty
 * <body>), which is sufficient for most job-description pages.
 */
async function extractPageText(url: string): Promise<string | null> {
  const platform = detectPlatform(url);

  if (platform === "greenhouse") {
    try {
      const { pathname } = new URL(url);
      const match = pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
      if (match) {
        const [, boardToken, jobId] = match;
        const text = await fetchGreenhouseJobText(boardToken, jobId);
        if (text) return text;
      }
    } catch {
      // fall through to the generic path below
    }
  }

  // Some companies embed Greenhouse's widget directly on their own domain
  // (e.g. buildops.com/careers/job-application?gh_jid=6100196004) instead
  // of linking to job-boards.greenhouse.io — detectPlatform won't recognize
  // this shape, and the specific job title only renders client-side, so a
  // plain fetch below would only see the generic page shell. The embed
  // script's own `for=` parameter reveals the real board token even though
  // the rest of the page doesn't. Confirmed real case: BuildOps.
  if (platform !== "greenhouse" && platform !== "ashby") {
    const embedded = await detectEmbeddedGreenhouseBoard(url);
    if (embedded) {
      const text = await fetchGreenhouseJobText(embedded.boardToken, embedded.jobId);
      if (text) return text;
    }
  }

  if (platform === "ashby") {
    try {
      const { pathname } = new URL(url);
      const match = pathname.match(/^\/([^/]+)\/([^/]+)/);
      if (match) {
        const [, orgSlug, jobId] = match;
        const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${orgSlug}`, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; JobFinderAgent/1.0)" },
        });
        if (res.ok) {
          const data = (await res.json()) as {
            jobs?: {
              id: string;
              title?: string;
              location?: string;
              employmentType?: string;
              workplaceType?: string;
              department?: string;
              descriptionPlain?: string;
            }[];
          };
          const job = data.jobs?.find((j) => j.id === jobId);
          if (job) {
            // The posting-api doesn't include the company/org display name —
            // pull it from the page's <title> tag, which is present even
            // though the rest of the page is client-rendered.
            let company: string | undefined;
            try {
              company = companyFromTitleTag(await fetchHtml(url));
            } catch {
              // proceed without it — Claude can still often infer it from the description
            }
            const fields = labeledFields({
              Title: job.title,
              Company: company,
              Location: job.location,
              "Employment type": job.employmentType,
              "Workplace type": job.workplaceType,
              Department: job.department,
            });
            return [fields, job.descriptionPlain?.trim()].filter(Boolean).join("\n\n").trim() || null;
          }
        }
      }
    } catch {
      // fall through to the generic path below
    }
  }

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // Some client-rendered SPAs ship an empty <body> in the raw HTML — the
    // real content only exists after JS hydrates the page — but still
    // populate the full job description into a meta description tag for
    // SEO/social-sharing. Prefer whichever source actually has real
    // content rather than assuming body text is where a page's content lives.
    const title = $("title").text().trim();
    const metaDescription =
      $('meta[name="description"]').attr("content")?.trim() ||
      $('meta[property="og:description"]').attr("content")?.trim() ||
      "";

    $("script, style, nav, footer, header, noscript, svg").remove();
    const bodyText = $("body").text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

    const combined = [title, metaDescription, bodyText].filter(Boolean).join("\n\n");
    return combined ? combined.slice(0, MAX_PAGE_TEXT) : null;
  } catch {
    return null;
  }
}

const submitTool = {
  name: TOOL_NAME,
  description: "Submit the extracted job details and a fit score for this specific posting.",
  input_schema: {
    type: "object" as const,
    properties: {
      company: { type: "string" },
      title: { type: "string" },
      location: { type: "string" },
      workMode: { type: "string", enum: ["remote", "hybrid", "onsite"] },
      salaryText: { type: "string" },
      matchScore: {
        type: "integer",
        description: "0-100 fit score against the candidate's resume and search criteria.",
      },
      rationale: {
        type: "string",
        description: "1-2 sentence explanation of the fit, grounded in the candidate's real background.",
      },
    },
    required: ["company", "title", "matchScore", "rationale"],
  },
};

/**
 * Scores a single, user-supplied job posting URL against the candidate's
 * profile and resume — the on-demand counterpart to the Job Search Agent
 * (which searches broadly for many candidates); this checks one specific
 * posting the user already found themselves. Applies the same closed/
 * generic/blocked-source checks used elsewhere before spending an API call
 * on a dead or untrustworthy link.
 */
export async function scoreJobUrl(params: {
  url: string;
  profile: CandidateProfile;
  resume: ResumeData;
}): Promise<ScoreJobUrlResult> {
  const { url, profile, resume } = params;

  if (isBlockedSource(url)) {
    return { ok: false, error: "This source requires payment to apply and isn't supported." };
  }
  if (looksLikeGenericCareersPage(url)) {
    return { ok: false, error: "That looks like a generic careers page, not a specific posting — paste the direct link to the role." };
  }

  const pageText = await extractPageText(url);
  if (!pageText) {
    return { ok: false, error: "Couldn't fetch that page. Check the URL, or the site may be blocking automated requests." };
  }
  if (textIndicatesClosedPosting(pageText)) {
    return { ok: false, error: "This posting appears to be closed or no longer accepting applications." };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not set — scoring requires it." };
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const criteria = profile.searchCriteria;
    const experienceText = resume.experience
      .map(
        (e) =>
          `${e.company} — ${e.role} (${e.dateRange}): ${e.bullets.map((b) => b.text).join(" ")}`
      )
      .join("\n");
    const skillsText = resume.skills.map((s) => `${s.category}: ${s.items.join(", ")}`).join("\n");

    const systemPrompt = `You extract job details and score fit for a real candidate, grounded strictly in the job posting text provided below. Rules:
- Extract company, title, location, work mode, and salary ONLY if actually present in the given page text — never guess or fabricate a detail that isn't there (use null/omit if genuinely absent).
- Score matchScore (0-100) based on genuine overlap between the posting's requirements and the candidate's actual resume experience/skills and stated search criteria — not superficial keyword matching.
- rationale must cite specific, real overlaps (or gaps) — reference actual resume experience, not generic language.
- Refer to the candidate as "the candidate" or "they/their" — you have no gender information, so never guess a gendered pronoun.
- Respond only via the ${TOOL_NAME} tool.`;

    const userMessage = `CANDIDATE RESUME EXPERIENCE
${experienceText}

CANDIDATE SKILLS
${skillsText}

CANDIDATE SEARCH CRITERIA
- Role families: ${criteria?.roleFamilies?.join(", ") ?? "n/a"}
- Locations: ${criteria?.locations?.join(", ") ?? "n/a"}
- Salary floor: ${criteria?.salaryFloor ? `$${criteria.salaryFloor.toLocaleString()}` : "n/a"}
- Industries: ${criteria?.industries?.join(", ") ?? "n/a"}

JOB POSTING PAGE TEXT (from ${url})
${pageText}

Extract the job details and score the fit.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools: [submitTool],
      tool_choice: { type: "tool", name: TOOL_NAME },
    });
    await logAnthropicUsage({ callSite: "score_job_url", model: MODEL, response });

    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return { ok: false, error: "Couldn't extract structured details from that page — try a different URL." };
    }

    const input = toolUse.input as {
      company?: string;
      title?: string;
      location?: string;
      workMode?: string;
      salaryText?: string;
      matchScore?: number;
      rationale?: string;
    };

    if (!input.company || !input.title || typeof input.rationale !== "string") {
      return { ok: false, error: "Couldn't confidently identify the role and company on that page." };
    }

    if (input.title && !textMentionsTitle(pageText, input.title)) {
      return { ok: false, error: "Couldn't confirm this posting's title actually appears on the page — it may have changed or redirected." };
    }

    return {
      ok: true,
      result: {
        company: input.company,
        title: input.title,
        location: cleanOptionalField(input.location),
        workMode: cleanOptionalField(input.workMode),
        salaryText: cleanOptionalField(input.salaryText),
        matchScore: Math.max(0, Math.min(100, Math.round(Number(input.matchScore) || 0))),
        rationale: input.rationale,
      },
    };
  } catch (err) {
    console.error("scoreJobUrl failed:", err);
    return { ok: false, error: "Scoring failed — the AI service may be temporarily unavailable." };
  }
}
