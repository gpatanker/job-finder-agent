// Hostnames known to gate the actual application behind a paywall/premium
// upsell rather than linking through to the employer's real application, or
// otherwise judged not worth surfacing as a source:
// - TheLadders shows a job listing for free but routes "Apply" to a
//   $29.97+/month "Apply4Me" membership paywall instead of the employer's
//   own application page.
// - ZipRecruiter: paywall/quality issues with its listings, per user
//   direction — excluded outright rather than just dropped from the search
//   agent's target-platform list, so a link is rejected even if one
//   surfaces via general search.
const BLOCKED_HOSTNAMES = new Set([
  "theladders.com",
  "www.theladders.com",
  "ziprecruiter.com",
  "www.ziprecruiter.com",
]);

export function isBlockedSource(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}
