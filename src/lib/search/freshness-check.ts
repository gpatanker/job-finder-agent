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
];

export function htmlIndicatesClosedPosting(html: string): boolean {
  const $ = cheerio.load(html);
  const visibleText = $("body").text().toLowerCase().replace(/\s+/g, " ");
  return CLOSED_PHRASES.some((phrase) => visibleText.includes(phrase));
}

/**
 * Best-effort liveness check: fetches the candidate's apply URL and scans
 * visible text for common "this posting is closed" phrasing (seen in
 * practice on job-board aggregators that mirror stale listings). Returns
 * true only when it's confident the posting is closed — any fetch failure,
 * timeout, or ambiguous result defaults to "assume still open" rather than
 * silently discarding a possibly-good lead.
 */
export async function isLikelyClosed(url: string, timeoutMs = 8000): Promise<boolean> {
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
    return htmlIndicatesClosedPosting(html);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
