/**
 * Safety gate for LLM-reworded resume bullets.
 *
 * The Resume Tailoring Agent may now reword bullet text to pick up a job
 * posting's own vocabulary, which plain synonym-swapping couldn't do. There is
 * deliberately NO human approval step in front of that, so the invariants have
 * to hold in code: a rewrite is accepted only if it says the same factual thing
 * as the original, in different words.
 *
 * What "the same factual thing" is checked to mean:
 *
 *  1. Every number is preserved EXACTLY AS WRITTEN. Not "the same value" —
 *     the same characters. "$3M" may not become "$3 million" or "$3,000,000",
 *     because once re-formatting is permitted there is no cheap way to tell a
 *     faithful reformat from a magnitude error ("$3M" -> "$3B" is one keystroke).
 *     Verbatim preservation is trivially checkable and impossible to get subtly
 *     wrong, and the prompt asks for exactly that.
 *  2. No new numbers appear. This is the fabrication that matters most on a
 *     resume — a model asked to make a bullet sound stronger will otherwise
 *     invent a percentage.
 *  3. Every proper noun / acronym survives (NVIDIA, Netbox, JIRA, Tableau,
 *     Public Sector Partners, CSP, SLA, POS...). Dropping one loses the context
 *     the candidate asked to keep; adding one invents an employer, tool or
 *     system that was never claimed.
 *  4. Length stays in a sane band, so a bullet can't be padded into a paragraph
 *     or gutted down to a fragment.
 *
 * Anything that fails is discarded and the original text is used. A rejected
 * rewrite is never an error — it just means that bullet didn't get reworded.
 */

export type RewriteCheck = { ok: true } | { ok: false; reason: string };

/**
 * Number-bearing tokens, captured with their adornments so "$3M", "4.8%",
 * "10,000+", "~2" and "12%" compare as written rather than as bare digits.
 */
const NUMBER_TOKEN = /[~$]?\d[\d,.]*\s*(?:%|[MKB]\b|million|billion|thousand)?\+?/gi;

/** Bare digit runs, used only to detect that a NEW number appeared. */
const DIGIT_RUN = /\d[\d,.]*/g;

function numberTokens(text: string): string[] {
  return (text.match(NUMBER_TOKEN) ?? []).map((t) => t.replace(/\s+/g, " ").trim());
}

function digitRuns(text: string): string[] {
  return (text.match(DIGIT_RUN) ?? []).map((d) => d.replace(/[,.]$/, ""));
}

/**
 * Proper nouns and acronyms: capitalized words that aren't the opening word of
 * the bullet (which is the action verb the rewrite is allowed to change), plus
 * all-caps acronyms anywhere. Deliberately crude — it over-collects rather than
 * under-collects, because a false rejection costs one un-reworded bullet while a
 * false acceptance can put a fabricated tool on a real resume.
 */
function properNouns(text: string, { includeFirstWord }: { includeFirstWord: boolean }): Set<string> {
  const words = text.split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  words.forEach((raw, i) => {
    const w = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+]+$/g, "");
    if (!w) return;
    if (i === 0 && !includeFirstWord) return;
    const isAcronym = /^[A-Z0-9]{2,}$/.test(w) && /[A-Z]/.test(w);
    const isCapitalized = /^[A-Z][a-z]+/.test(w);
    if (isAcronym || isCapitalized) out.add(w.toLowerCase());
  });
  return out;
}

export function validateRewrite(
  original: string,
  rewrite: string,
  /**
   * Extra vocabulary that counts as already-supported — in practice the bullet's
   * own pre-approved synonym options. Without this the guard rejects wording the
   * candidate has explicitly blessed: a real case was "go-to-market efforts" ->
   * "GTM efforts", where "GTM efforts" is literally one of that bullet's
   * synonyms, but "GTM" appears nowhere in the original text.
   */
  approvedVocabulary: string[] = []
): RewriteCheck {
  const approved = approvedVocabulary.join(" ").toLowerCase();
  const clean = rewrite.trim();
  if (!clean) return { ok: false, reason: "empty rewrite" };
  if (clean === original.trim()) return { ok: true }; // no-op is harmless

  // 1 + 2. Numbers: same tokens, verbatim, and no new ones.
  const origNums = numberTokens(original);
  const newNums = numberTokens(clean);
  for (const tok of origNums) {
    if (!clean.includes(tok)) {
      return { ok: false, reason: `number "${tok}" missing or reformatted` };
    }
  }
  const origDigits = digitRuns(original).sort();
  const newDigits = digitRuns(clean).sort();
  if (origDigits.length !== newDigits.length || origDigits.some((d, i) => d !== newDigits[i])) {
    const added = newDigits.filter((d) => !origDigits.includes(d));
    return {
      ok: false,
      reason: added.length ? `introduced number(s): ${added.join(", ")}` : "a number was dropped",
    };
  }
  if (newNums.length !== origNums.length) {
    return { ok: false, reason: "number count changed" };
  }

  // 3. Entities: none dropped, none invented.
  const origEntities = properNouns(original, { includeFirstWord: false });
  for (const e of origEntities) {
    if (!clean.toLowerCase().includes(e)) {
      return { ok: false, reason: `dropped context: "${e}"` };
    }
  }
  // The rewrite's FIRST word is its action verb and may change freely ("Reduced"
  // -> "Cut"). Enumerating allowed verbs instead was brittle — the list will
  // never be complete, and every miss silently costs a legitimate rewrite.
  // Everything after position 0 must be supported by the original.
  const rewriteEntities = properNouns(clean, { includeFirstWord: false });
  for (const e of rewriteEntities) {
    if (!origEntities.has(e) && !original.toLowerCase().includes(e) && !approved.includes(e)) {
      return { ok: false, reason: `introduced unsupported term: "${e}"` };
    }
  }
  // ...but an acronym or model-number in the lead position is an entity, not a
  // verb, so it still has to be backed by the original.
  const firstWord = (clean.split(/\s+/)[0] ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (
    /^[A-Z0-9]{2,}$/.test(firstWord) &&
    !original.toLowerCase().includes(firstWord.toLowerCase()) &&
    !approved.includes(firstWord.toLowerCase())
  ) {
    return { ok: false, reason: `introduced unsupported term: "${firstWord}"` };
  }

  // 4. Length sanity.
  const ratio = clean.length / original.trim().length;
  if (ratio > 1.6) return { ok: false, reason: `rewrite ${ratio.toFixed(2)}x longer than original` };
  if (ratio < 0.55) return { ok: false, reason: `rewrite ${ratio.toFixed(2)}x of original — context likely lost` };

  return { ok: true };
}
