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
export function parseGreenhouseHtml(html: string): ScrapeResult {
  const warnings: string[] = [];
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

type GreenhouseApiQuestion = {
  label?: string;
  fields?: { type?: string }[];
};

type GreenhouseApiResponse = {
  questions?: GreenhouseApiQuestion[];
};

/**
 * Newer Greenhouse job-board templates (job-boards.greenhouse.io) render the
 * application form — including custom questions — entirely client-side via
 * a Nuxt.js SPA; the initial HTML has no <textarea>/question_* markup at all
 * (confirmed live: a fetched Samsara posting had zero such elements in
 * 955KB of markup). Greenhouse's public Job Board API exposes the same form
 * schema as JSON (https://developers.greenhouse.io/job-board.html,
 * unauthenticated, intended for third-party consumption) and works for both
 * this SPA template and the legacy server-rendered one, so we try it first.
 */
export function extractGreenhouseIds(url: string): { boardToken: string; jobId: string } | null {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if (!match) return null;
    return { boardToken: match[1], jobId: match[2] };
  } catch {
    return null;
  }
}

/**
 * A "candidate-written prompt" is an open-ended essay question — the API
 * marks these with a `textarea` field type, distinct from the short
 * structured fields (name/zip/current employer, type `input_text`) and
 * multiple-choice questions (`multi_value_single_select`/`multi_select`)
 * that make up most of a typical Greenhouse form. Standard PII/EEO fields
 * are filtered the same way as the HTML path; Greenhouse's own
 * `demographic_questions` key is separate from `questions` and never
 * consulted here.
 */
function parseGreenhouseJson(data: GreenhouseApiResponse): ScrapeResult {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const questions: { prompt: string }[] = [];

  for (const q of data.questions ?? []) {
    const label = q.label?.trim();
    if (!label || seen.has(label) || isStandardField(label)) continue;
    const isEssay = (q.fields ?? []).some((f) => f.type === "textarea");
    if (!isEssay) continue;
    seen.add(label);
    questions.push({ prompt: label });
  }

  if (questions.length === 0) {
    warnings.push(
      "No candidate-written prompts found — this posting's official application form has no open-ended essay questions (only standard fields and/or multiple-choice questions)."
    );
  }

  return { questions, source: "greenhouse", warnings };
}

export async function scrapeGreenhouse(url: string): Promise<ScrapeResult> {
  const ids = extractGreenhouseIds(url);
  if (ids) {
    try {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${ids.boardToken}/jobs/${ids.jobId}?questions=true`,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; JobFinderAgent/1.0)" } }
      );
      if (res.ok) {
        return parseGreenhouseJson(await res.json());
      }
    } catch {
      // Fall through to the HTML path below — e.g. a board token/job id
      // that looks right but isn't actually a public Greenhouse board.
    }
  }

  const html = await fetchHtml(url);
  return parseGreenhouseHtml(html);
}
