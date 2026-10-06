/**
 * A tailoring plan reorders existing bullets/skills, swaps in pre-approved
 * synonym phrasing, and may reword bullet text to pick up a job posting's own
 * vocabulary. Rendering and the Resume Tailoring Agent both operate on this
 * same shape so the "no tailoring" render (used as the golden-master baseline)
 * and a tailored render share one code path.
 *
 * Rewording is NOT unconstrained: every entry in `bulletRewrites` is re-checked
 * by validateRewrite() at apply time and discarded unless it preserves the
 * original's numbers verbatim and its named entities. See rewrite-guard.ts.
 */
export type TailoringPlan = {
  /** company name -> ordered list of that company's existing bullet IDs */
  bulletOrder: Record<string, string[]>;
  /** bulletId -> { originalPhrase: chosenReplacementText } */
  phraseChoices: Record<string, Record<string, string>>;
  /**
   * bulletId -> reworded bullet text, aligned to the job posting's language.
   * Applied only if it passes validateRewrite(); otherwise the original text is
   * kept. Mutually exclusive with phraseChoices for the same bullet — a reworded
   * bullet no longer contains the synonym keys.
   */
  bulletRewrites?: Record<string, string>;
  /** skill category names, in chosen display order */
  skillsOrder: string[];
  /** keyword-coverage score (0-100) against the job description, for display */
  coverageScore?: number;
  /** short human-readable rationale, for the diff view */
  rationale?: string;
};

export function emptyTailoringPlan(): TailoringPlan {
  return { bulletOrder: {}, phraseChoices: {}, bulletRewrites: {}, skillsOrder: [] };
}
