// Hostnames known to gate the actual application behind a paywall/premium
// upsell rather than linking through to the employer's real application, or
// otherwise excluded per user direction:
// - TheLadders shows a job listing for free but routes "Apply" to a
//   $29.97+/month "Apply4Me" membership paywall instead of the employer's
//   own application page.
// - ZipRecruiter: paywall/quality issues with its listings.
// Excluded outright rather than just dropped from the search agent's
// target-platform list, so a link is rejected even if one surfaces via
// general search (not only when the agent deliberately searched there).
const BLOCKED_HOSTNAMES = new Set([
  "theladders.com",
  "www.theladders.com",
  "ziprecruiter.com",
  "www.ziprecruiter.com",
]);

// BuiltIn runs many region-specific domains (builtin.com, builtinsf.com,
// builtinnyc.com, builtinchicago.org, etc.) rather than one single
// hostname — matched by pattern instead of trying to enumerate every
// regional variant. Excluded per user direction.
const BLOCKED_HOSTNAME_PATTERNS = [/^(www\.)?builtin[a-z]*\.(com|org)$/i];

export function isBlockedSource(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname)) return true;
    return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}
