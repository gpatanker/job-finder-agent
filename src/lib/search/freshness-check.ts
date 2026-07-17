import * as cheerio from "cheerio";

const CLOSED_PHRASES = [
  "position is closed",
  "position has been filled",
  "no longer accepting applications",
  "this job is no longer available",
  "this position is no longer available",
  "job posting has expired",
  "posting has expired",
  "is probably filled",
  "please do not apply",
  "this listing is no longer active",
  "no longer accepting new applicants",
  "no longer open",
  "job you are looking for is no longer open",
];

export function textIndicatesClosedPosting(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  return CLOSED_PHRASES.some((phrase) => normalized.includes(phrase));
}

export function htmlIndicatesClosedPosting(html: string): boolean {
  const $ = cheerio.load(html);
  return textIndicatesClosedPosting($("body").text());
}

function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Text-based counterpart to pageMentionsTitle, for callers that already have
 * extracted plain text rather than raw HTML.
 *
 * Requiring the exact title phrase as a substring (the original approach) is
 * stricter than it needs to be: a live posting commonly renders the title
 * with an extra seniority/location qualifier the search agent's reported
 * title doesn't include (e.g. page says "Senior Revenue Strategy &
 * Operations Manager", agent reported "Revenue Strategy & Operations") —
 * that's still the same posting, just phrased slightly differently, and the
 * old exact-phrase check would wrongly mark it closed. So: an exact
 * substring match still short-circuits to true, but otherwise we fall back
 * to word-overlap — most (>=70%) of the title's significant words must
 * appear somewhere on the page. Overlap alone is too loose for short,
 * generic titles ("Operations Manager") where a company's general listings
 * page could coincidentally contain both words for an unrelated role — the
 * real case that motivated the strict check in the first place — so titles
 * with 2 or fewer significant words still require the exact phrase.
 */
export function textMentionsTitle(text: string, title: string): boolean {
  const normalizedTitle = normalizePhrase(title);
  if (!normalizedTitle) return true;
  const normalizedText = normalizePhrase(text);
  if (normalizedText.includes(normalizedTitle)) return true;

  const titleWords = normalizedTitle.split(" ").filter(Boolean);
  if (titleWords.length <= 2) return false;

  const textWords = new Set(normalizedText.split(" ").filter(Boolean));
  const matched = titleWords.filter((w) => textWords.has(w)).length;
  return matched / titleWords.length >= 0.7;
}

/**
 * Stricter than keyword overlap on purpose: individual words from a job
 * title ("business", "operations") commonly appear elsewhere on a careers
 * page (other departments, nav labels) even when the specific role is gone
 * — a real case (Fireworks AI) scored 2/4 keyword overlap on a page that
 * had silently redirected to the company's general "Current Openings"
 * board after the role closed. Requiring the (near-)full title phrase to
 * appear is what actually distinguishes "this is that job's page" from
 * "this page happens to mention some of the same words."
 */
export function pageMentionsTitle(html: string, title: string): boolean {
  const $ = cheerio.load(html);
  return textMentionsTitle($("body").text(), title);
}

/**
 * Best-effort liveness check: fetches the candidate's apply URL once and
 * evaluates multiple staleness signals against it —
 *   1. HTTP 404/410 (itself a strong closed/removed signal)
 *   2. Explicit "closed"/"filled"/"expired" phrasing in the visible text
 *   3. The expected job title not appearing anywhere on the page (catches
 *      client-side-rendered "no longer open" redirects to a company's
 *      general careers board, where the closed banner itself is injected
 *      by JS and invisible to a plain fetch, but the page obviously
 *      doesn't contain the specific role anymore either)
 * Any fetch failure, timeout, or ambiguous result defaults to "assume
 * still open" rather than silently discarding a possibly-good lead.
 */
export async function isLikelyClosed(
  url: string,
  title?: string,
  timeoutMs = 8000
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JobFinderAgent/1.0; +personal job application tracker)",
      },
    });
    // A 404/410 is itself a strong closed/removed signal — some job boards
    // return a non-OK status *and* still render a helpful "this posting is
    // closed" page, so don't bail before reading the body.
    if (res.status === 404 || res.status === 410) return true;
    if (!res.ok) return false;
    const html = await res.text();
    if (htmlIndicatesClosedPosting(html)) return true;
    if (title && !pageMentionsTitle(html, title)) return true;
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Separate from isLikelyClosed: a 403/429/503 means our request was
 * blocked (bot protection, rate limiting), not that the page confirmed
 * open — isLikelyClosed already treats any non-404/410 non-ok status as
 * "assume open" for good reason (a 500 or network hiccup shouldn't sink a
 * possibly-good lead), but a bot-protection block is different: it means
 * we genuinely can't see the page at all. Confirmed real case: OpenAI's
 * Cloudflare challenge returned 403 for a posting whose real,
 * browser-rendered page was a genuine custom 404 — our fetch-based check
 * silently passed it through as "not closed" when it couldn't actually
 * verify anything either way. Callers should treat this as "try the
 * recovery path" rather than a hard rejection, since it's not evidence of
 * closure, just an inability to confirm openness.
 */
export async function isLikelyBotBlocked(url: string, timeoutMs = 8000): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JobFinderAgent/1.0; +personal job application tracker)",
      },
    });
    return res.status === 403 || res.status === 429 || res.status === 503;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
