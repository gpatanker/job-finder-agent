const GENERIC_PATH_SEGMENTS = new Set([
  "careers",
  "career",
  "jobs",
  "job",
  "join-us",
  "join",
  "work-with-us",
  "work-here",
  "about-us",
  "positions",
  "openings",
  "opportunities",
  "hiring",
]);

/**
 * Some companies embed their ATS's application widget directly on an
 * otherwise-generic careers page (e.g. `emeraldai.co/careers?ashby_jid=...`,
 * `ripple.com/careers/all-jobs/job/7646422/?gh_jid=7646422`) — the path
 * alone looks like a bare landing page, but the query string pins it to one
 * specific posting just as reliably as a path-based job ID would. Real case:
 * `www.emeraldai.co/careers?ashby_jid=21596d2f-8ddb-4131-bd03-1d338e32e679`
 * was wrongly flagged generic because the check never looked past the path.
 */
const JOB_ID_QUERY_PARAMS = ["gh_jid", "ashby_jid"];

/**
 * Heuristic: a real job-posting deep link almost always has a job ID or a
 * role-specific slug in its path (Greenhouse/Ashby/Lever URLs always do), or
 * a job-ID query parameter from an embedded ATS widget. A bare "/careers",
 * "/jobs", "/join-us" with nothing after it and no such query param is a
 * generic landing page, not a link to any specific posting — exactly what
 * happened with a real suggestion (`snorkel.ai/join-us/`) that didn't
 * actually take the user to the role it claimed to be for.
 */
export function looksLikeGenericCareersPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (JOB_ID_QUERY_PARAMS.some((param) => parsed.searchParams.has(param))) {
    return false;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  if (segments.length === 1 && GENERIC_PATH_SEGMENTS.has(segments[0].toLowerCase())) {
    return true;
  }
  return false;
}
