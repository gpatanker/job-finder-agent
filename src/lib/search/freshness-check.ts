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

/** Text-based counterpart to pageMentionsTitle, for callers that already have extracted plain text rather than raw HTML. */
export function textMentionsTitle(text: string, title: string): boolean {
  const normalizedTitle = normalizePhrase(title);
  if (!normalizedTitle) return true;
  return normalizePhrase(text).includes(normalizedTitle);
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
