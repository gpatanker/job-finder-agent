/**
 * A tailoring plan only ever reorders existing bullets/skills and swaps in
 * pre-approved synonym phrasing — it never introduces new text. Rendering
 * and the Resume Tailoring Agent both operate on this same shape so the
 * "no tailoring" render (used as the golden-master baseline) and a tailored
 * render share one code path.
 */
export type TailoringPlan = {
  /** company name -> ordered list of that company's existing bullet IDs */
  bulletOrder: Record<string, string[]>;
  /** bulletId -> { originalPhrase: chosenReplacementText } */
  phraseChoices: Record<string, Record<string, string>>;
  /** skill category names, in chosen display order */
  skillsOrder: string[];
  /** keyword-coverage score (0-100) against the job description, for display */
  coverageScore?: number;
  /** short human-readable rationale, for the diff view */
  rationale?: string;
};

export function emptyTailoringPlan(): TailoringPlan {
  return { bulletOrder: {}, phraseChoices: {}, skillsOrder: [] };
}
