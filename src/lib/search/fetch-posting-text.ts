import * as cheerio from "cheerio";
import { detectPlatform } from "@/lib/scraping";
import { fetchHtml } from "@/lib/scraping/types";
import { detectEmbeddedGreenhouseBoard } from "./live-board";

const USER_AGENT = "Mozilla/5.0 (compatible; JobFinderAgent/1.0)";
const FETCH_TIMEOUT_MS = 8000;
// Generous cap so a single runaway page can't blow an LLM call's context
// budget or bloat the DB column — no real job posting approaches this.
const MAX_TEXT_LENGTH = 20000;

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${jobId}`,
      { signal: controller.signal, headers: { "User-Agent": USER_AGENT } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      company_name?: string;
      location?: { name?: string };
      content?: string;
    };
    // `content` is Greenhouse's raw description HTML (entity-escaped) —
    // cheerio decodes entities and lets us pull plain text out of it.
    const descriptionText = cheerio.load(data.content ?? "")("body").text().trim();
    const fields = labeledFields({
      Title: data.title,
      Company: data.company_name,
      Location: data.location?.name,
    });
    return [fields, descriptionText].filter(Boolean).join("\n\n").trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
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
 *
 * Used both to score a user-pasted URL (scoreJobUrl) and to backfill
 * `jobs.jobDescription` when a suggestion is promoted into the pipeline —
 * see src/app/api/search/suggestions/[id]/promote/route.ts. The full
 * labeled-fields + description text this returns is what resume tailoring
 * and coverage scoring are computed against, so it deliberately includes
 * more than just the description prose.
 */
export async function fetchJobPostingText(url: string): Promise<string | null> {
  const text = await fetchJobPostingTextUncapped(url);
  return text ? text.slice(0, MAX_TEXT_LENGTH) : null;
}

async function fetchJobPostingTextUncapped(url: string): Promise<string | null> {
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${orgSlug}`, {
            signal: controller.signal,
            headers: { "User-Agent": USER_AGENT },
          });
        } finally {
          clearTimeout(timeout);
        }
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
    return combined || null;
  } catch {
    return null;
  }
}
