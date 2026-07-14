import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { isStandardField } from "./exclude-list";
import { fetchHtml, type ScrapeResult } from "./types";

/**
 * Greenhouse's current job board template renders custom questions
 * server-side as <textarea>/<input> elements with id="question_<id>" and an
 * aria-label holding the question text (confirmed against live postings).
 * Standard fields (name/email/phone/resume/etc.) use non-"question_" ids and
 * are naturally excluded; short single-line question_* fields (URLs,
 * dropdowns) are excluded via isStandardField + a question-like heuristic so
 * we don't surface "LinkedIn Profile" as a candidate-written prompt.
 */
export async function scrapeGreenhouse(url: string): Promise<ScrapeResult> {
  const warnings: string[] = [];
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const seen = new Set<string>();
  const questions: { prompt: string }[] = [];

  function labelFor(el: Element): string {
    const $el = $(el);
    const ariaLabel = $el.attr("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    const id = $el.attr("id");
    if (id) {
      const label = $(`label[for="${id}"]`).first().text().trim();
      if (label) return label.replace(/\*\s*$/, "").trim();
    }
    return "";
  }

  $("textarea").each((_, el) => {
    const id = $(el).attr("id") ?? "";
    if (!id.startsWith("question_")) return;
    const label = labelFor(el);
    if (!label || isStandardField(label) || seen.has(label)) return;
    seen.add(label);
    questions.push({ prompt: label });
  });

  $('input[id^="question_"]').each((_, el) => {
    const $el = $(el);
    const type = $el.attr("type");
    const role = $el.attr("role");
    if (type === "hidden" || type === "file" || role === "combobox") return;
    const label = labelFor(el);
    if (!label || isStandardField(label) || seen.has(label)) return;
    // Single-line fields are only included if they read like a genuine
    // written question, not a short structured field (URL, city/state, etc.)
    const looksLikeQuestion = label.includes("?") || label.length > 40;
    if (!looksLikeQuestion) return;
    seen.add(label);
    questions.push({ prompt: label });
  });

  if (questions.length === 0) {
    warnings.push(
      "No candidate-written prompts found — this posting may only have standard profile fields, or Greenhouse may have changed their form markup."
    );
  }

  return { questions, source: "greenhouse", warnings };
}
