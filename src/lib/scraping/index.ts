import { scrapeGreenhouse } from "./greenhouse";
import { scrapeAshby } from "./ashby";
import { scrapeGeneric } from "./generic";
import type { ScrapeResult } from "./types";

export async function scrapeApplicationQuestions(
  url: string
): Promise<ScrapeResult> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return {
      questions: [],
      source: "generic",
      warnings: [`"${url}" isn't a valid URL.`],
    };
  }

  try {
    if (hostname.includes("greenhouse.io")) {
      return await scrapeGreenhouse(url);
    }
    if (hostname.includes("ashbyhq.com")) {
      return await scrapeAshby(url);
    }
    return await scrapeGeneric(url);
  } catch (err) {
    return {
      questions: [],
      source: "generic",
      warnings: [
        `Scraping failed: ${err instanceof Error ? err.message : "unknown error"}. The form may be JavaScript-rendered, multi-step, or auth-gated — add prompts manually if there are any.`,
      ],
    };
  }
}
