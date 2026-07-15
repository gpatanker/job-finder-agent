import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";
import type { CandidateProfile, ResumeData } from "@/lib/db/schema";
import { detectPlatform } from "@/lib/scraping";
import { fetchHtml } from "@/lib/scraping/types";
import { isBlockedSource } from "./blocked-sources";
import { looksLikeGenericCareersPage } from "./specificity-check";
import { textIndicatesClosedPosting, textMentionsTitle } from "./freshness-check";

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

export type ScoreJobUrlResult =
  | { ok: true; result: JobScoreResult }
  | { ok: false; error: string };

/**
 * Fetches a single job posting's readable content. Greenhouse's public Job
 * Board API (used elsewhere for scraping — see scraping/greenhouse.ts) is
 * tried first since it reliably returns the description as clean JSON even
 * for the newer job-boards.greenhouse.io template that renders its
 * application form client-side; everything else falls back to a plain
 * fetch + stripped-down visible body text, which is sufficient for most
 * job-description pages (unlike application *forms*, descriptions are
 * typically server-rendered for SEO).
 */
async function extractPageText(url: string): Promise<string | null> {
  if (detectPlatform(url) === "greenhouse") {
    try {
      const { pathname } = new URL(url);
      const match = pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
      if (match) {
        const [, boardToken, jobId] = match;
        const res = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${jobId}`,
          { headers: { "User-Agent": "Mozilla/5.0 (compatible; JobFinderAgent/1.0)" } }
        );
        if (res.ok) {
          const data = (await res.json()) as {
            title?: string;
            company_name?: string;
            location?: { name?: string };
            content?: string;
          };
          const descriptionText = cheerio.load(data.content ?? "")("body").text();
          return [data.title, data.company_name, data.location?.name, descriptionText]
            .filter(Boolean)
            .join("\n\n")
            .trim();
        }
      }
    } catch {
      // fall through to the generic path below
    }
  }

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    $("script, style, nav, footer, header, noscript, svg").remove();
    const text = $("body").text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    return text.slice(0, MAX_PAGE_TEXT);
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
        location: input.location ?? null,
        workMode: input.workMode ?? null,
        salaryText: input.salaryText ?? null,
        matchScore: Math.max(0, Math.min(100, Math.round(Number(input.matchScore) || 0))),
        rationale: input.rationale,
      },
    };
  } catch (err) {
    console.error("scoreJobUrl failed:", err);
    return { ok: false, error: "Scoring failed — the AI service may be temporarily unavailable." };
  }
}
