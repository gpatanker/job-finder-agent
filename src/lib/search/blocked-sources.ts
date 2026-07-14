// Hostnames known to gate the actual application behind a paywall/premium
// upsell rather than linking through to the employer's real application —
// confirmed real case: TheLadders shows a job listing for free but routes
// "Apply" to a $29.97+/month "Apply4Me" membership paywall instead of the
// employer's own application page.
const BLOCKED_HOSTNAMES = new Set(["theladders.com", "www.theladders.com"]);

export function isBlockedSource(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}
