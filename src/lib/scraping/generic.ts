import * as cheerio from "cheerio";
import { isStandardField } from "./exclude-list";
import { fetchHtml, type ScrapeResult } from "./types";

/**
 * Platform-agnostic fallback: scans <textarea> elements (the strongest
 * signal for a candidate-written prompt) with a label found via aria-label,
 * label[for], a wrapping <label>, or a preceding sibling label-like element.
 */
export function parseGenericHtml(html: string): ScrapeResult {
  const warnings: string[] = [];
  const $ = cheerio.load(html);

  const seen = new Set<string>();
  const questions: { prompt: string }[] = [];

  $("textarea").each((_, el) => {
    const $el = $(el);
    let label = $el.attr("aria-label")?.trim() ?? "";

    if (!label) {
      const id = $el.attr("id");
      if (id) label = $(`label[for="${id}"]`).first().text().trim();
    }
    if (!label) {
      label = $el.closest("label").text().trim();
    }
    if (!label) {
      label = $el.prevAll("label, p, span, div").first().text().trim();
    }
    if (!label || isStandardField(label) || seen.has(label)) return;
    seen.add(label);
    questions.push({ prompt: label });
  });

  if (questions.length === 0) {
    warnings.push(
      "No long-form prompts found via generic scanning. This form may be JavaScript-rendered, multi-step, or auth-gated — add prompts manually if there are any."
    );
  }

  return { questions, source: "generic", warnings };
}

export async function scrapeGeneric(url: string): Promise<ScrapeResult> {
  const html = await fetchHtml(url);
  return parseGenericHtml(html);
}
