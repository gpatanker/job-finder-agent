import * as cheerio from "cheerio";
import { isStandardField } from "./exclude-list";
import { fetchHtml, type ScrapeResult } from "./types";

/**
 * Ashby's job posting page is server-rendered, but the application form
 * itself (including any custom questions) is loaded client-side via an
 * internal API call after the candidate clicks "Apply" — confirmed by
 * inspecting live Ashby postings: no textarea/question markup or embedded
 * form-schema JSON exists in the initial HTML, and their documented public
 * job-board API (api.ashbyhq.com/posting-api) only returns listing/
 * description fields, not the application form. A plain HTTP fetch
 * genuinely cannot see these questions. We still attempt a best-effort scan
 * in case a given org's page differs, but are upfront about the limitation
 * rather than pretending this works reliably.
 */
export async function scrapeAshby(url: string): Promise<ScrapeResult> {
  const warnings: string[] = [
    "Ashby loads its application form (including any custom questions) dynamically after you click Apply — a page fetch can't see it. Open the apply link and add prompts manually if there are any.",
  ];
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const seen = new Set<string>();
  const questions: { prompt: string }[] = [];

  $("textarea").each((_, el) => {
    const $el = $(el);
    const label =
      $el.attr("aria-label")?.trim() ||
      $(`label[for="${$el.attr("id")}"]`).first().text().trim();
    if (!label || isStandardField(label) || seen.has(label)) return;
    seen.add(label);
    questions.push({ prompt: label });
  });

  return { questions, source: "ashby", warnings };
}
