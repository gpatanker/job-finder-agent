export type ScrapedQuestion = { prompt: string };

export type ScrapeResult = {
  questions: ScrapedQuestion[];
  source: "greenhouse" | "ashby" | "generic";
  warnings: string[];
};

export async function fetchHtml(url: string, timeoutMs = 10000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; JobFinderAgent/1.0; +personal job application tracker)",
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}
