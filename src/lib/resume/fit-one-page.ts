import type { ResumeData } from "@/lib/db/schema";
import type { TailoringPlan } from "./types";
import { applyTailoring } from "./apply-tailoring";

/**
 * Keeps a tailored resume at exactly one page.
 *
 * The master resume is deliberately tuned to fill a single page with very
 * little slack — that density is a feature, not an accident. Bullet rewording
 * (see rewrite-guard.ts) can change line lengths, and because the layout sits
 * right at the page boundary, even a tiny increase tips it over: the first
 * reworded resume grew total bullet text by **1%** and rendered as 2 pages.
 * pdfkit adds that second page silently, so without this nothing would catch it.
 *
 * Strategy: give back the length-adding tailoring one piece at a time,
 * re-rendering after each, until the document fits. Rewrites go first (they add
 * the most), then synonym swaps — a swap like "Negotiated" -> "Drove procurement
 * negotiations for" is 20 characters longer, and enough of them will push the
 * page over on their own. A real run dropped every rewrite, still rendered two
 * pages, and wrongly reported the master as too long, because swaps were never
 * considered. Bullet and skill ORDERING is never touched: it costs no space and
 * carries most of the relevance gain.
 *
 * If it still doesn't fit with zero rewrites, the master resume itself is too
 * long. That's a content problem for the candidate to resolve, not something to
 * paper over by silently cutting bullets, so it's reported rather than fixed.
 */

/** Counts `/Type /Page` objects, excluding the `/Pages` tree node. */
export function countPdfPages(pdf: Buffer): number {
  const matches = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

export type FitResult = {
  plan: TailoringPlan;
  pdf: Buffer;
  pages: number;
  /** Bullet IDs whose rewrite was given up to make the page fit. */
  droppedRewrites: string[];
  /** Bullet IDs whose synonym swaps were given up, after rewrites ran out. */
  droppedSwaps: string[];
  /** True when even the un-reworded resume overflows — a master-resume problem. */
  overflowsWithoutRewrites: boolean;
};

export async function fitPlanToOnePage(
  resume: ResumeData,
  plan: TailoringPlan,
  render: (data: ResumeData) => Promise<Buffer>
): Promise<FitResult> {
  const originalById = new Map<string, string>();
  // Section index = position in the experience list, which is reverse-chronological.
  // 0 is the current role. Used to decide WHICH rewrite to sacrifice: giving up
  // tailoring on the most recent, most relevant job to save space is the wrong
  // trade, since that section is what a recruiter reads first and what an ATS
  // weights most. A purely greedy largest-delta-first rule got this wrong in
  // practice — it stripped all four Together AI rewrites (current role) while
  // keeping every AWS one (2022-2024).
  const sectionById = new Map<string, number>();
  resume.experience.forEach((exp, i) => {
    for (const b of exp.bullets) {
      originalById.set(b.id, b.text);
      sectionById.set(b.id, i);
    }
  });

  let working: TailoringPlan = {
    ...plan,
    bulletRewrites: { ...(plan.bulletRewrites ?? {}) },
    phraseChoices: { ...(plan.phraseChoices ?? {}) },
  };
  const dropped: string[] = [];
  const droppedSwaps: string[] = [];

  let pdf = await render(applyTailoring(resume, working));
  let pages = countPdfPages(pdf);

  /** Length a bullet's synonym swaps add, so a swap can be compared to a rewrite. */
  const swapDelta = (bulletId: string): number => {
    const choices = working.phraseChoices?.[bulletId];
    const original = originalById.get(bulletId);
    if (!choices || !original) return 0;
    let text = original;
    for (const [phrase, chosen] of Object.entries(choices)) {
      if (text.includes(phrase)) text = text.replace(phrase, chosen);
    }
    return text.length - original.length;
  };

  while (pages > 1) {
    type Candidate = { kind: "swap" | "rewrite"; id: string; delta: number; section: number };
    const candidates: Candidate[] = [
      ...Object.keys(working.phraseChoices ?? {}).map((id) => ({
        kind: "swap" as const,
        id,
        delta: swapDelta(id),
        section: sectionById.get(id) ?? 0,
      })),
      ...Object.entries(working.bulletRewrites ?? {}).map(([id, text]) => ({
        kind: "rewrite" as const,
        id,
        delta: text.length - (originalById.get(id)?.length ?? text.length),
        section: sectionById.get(id) ?? 0,
      })),
    ];
    if (candidates.length === 0) break;

    // What to sacrifice, in order of preference:
    //  1. Things that actually add length — they are why the page overflows.
    //     (Character delta is only a proxy for height: an equal-or-shorter item
    //     can still wrap to an extra line, so once the growers are gone the rest
    //     stay eligible rather than the loop giving up.)
    //  2. Synonym swaps before rewrites. A swap is an alternate phrasing of the
    //     same idea; a rewrite carries the job posting's actual vocabulary, which
    //     is the thing an ATS scores. Giving back rewrites first was measurably
    //     wrong — it stripped every keyword-bearing rewrite while leaving the
    //     merely-longer swaps that were causing the overflow in the first place.
    //  3. Older roles before the current one — the top of the resume is what a
    //     recruiter reads first and what an ATS weights most.
    //  4. Biggest space win first, to converge in fewer re-renders.
    const grew = candidates.filter((c) => c.delta > 0);
    const pool = grew.length > 0 ? grew : candidates;
    pool.sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === "swap" ? -1 : 1) ||
        b.section - a.section ||
        b.delta - a.delta
    );

    const give = pool[0];
    if (give.kind === "swap") {
      const next = { ...working.phraseChoices };
      delete next[give.id];
      working = { ...working, phraseChoices: next };
      droppedSwaps.push(give.id);
    } else {
      delete working.bulletRewrites![give.id];
      dropped.push(give.id);
    }

    pdf = await render(applyTailoring(resume, working));
    pages = countPdfPages(pdf);
  }

  return {
    plan: working,
    pdf,
    pages,
    droppedRewrites: dropped,
    droppedSwaps,
    // Only a genuine master-resume problem once ALL length-adding tailoring —
    // rewrites and synonym swaps alike — has been given back.
    overflowsWithoutRewrites:
      pages > 1 &&
      Object.keys(working.bulletRewrites ?? {}).length === 0 &&
      Object.keys(working.phraseChoices ?? {}).length === 0,
  };
}
