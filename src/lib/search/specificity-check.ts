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
 * Heuristic: a real job-posting deep link almost always has a job ID or a
 * role-specific slug in its path (Greenhouse/Ashby/Lever URLs always do).
 * A bare "/careers", "/jobs", "/join-us" (with nothing after it) is a
 * generic landing page, not a link to any specific posting — exactly what
 * happened with a real suggestion (`snorkel.ai/join-us/`) that didn't
 * actually take the user to the role it claimed to be for.
 */
export function looksLikeGenericCareersPage(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  if (segments.length === 1 && GENERIC_PATH_SEGMENTS.has(segments[0].toLowerCase())) {
    return true;
  }
  return false;
}
