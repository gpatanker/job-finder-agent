import type { ResumeData } from "@/lib/db/schema";
import type { TailoringPlan } from "./types";
import { validateRewrite } from "./rewrite-guard";

/**
 * Applies a tailoring plan to base resume data.
 *
 * Three transformations, in precedence order per bullet:
 *   1. A reworded bullet (`bulletRewrites`) — but ONLY if validateRewrite()
 *      confirms it preserves every number verbatim and every named entity from
 *      the original. There is no human approval step in front of this, so the
 *      check is the safety boundary; a rewrite that fails is silently dropped
 *      and the original text is used.
 *   2. Otherwise, synonym swaps that are literally present in that bullet's
 *      pre-approved `synonyms` map. Skipped for a reworded bullet, whose text no
 *      longer contains the synonym keys.
 *   3. Bullet and skill-category reordering.
 *
 * Anything else in the plan is ignored rather than applied, so a malformed or
 * adversarial plan cannot introduce fabricated text.
 */
export function applyTailoring(
  resume: ResumeData,
  plan: TailoringPlan
): ResumeData {
  const experience = resume.experience.map((exp) => {
    const bulletsById = new Map(exp.bullets.map((b) => [b.id, b]));
    const requestedOrder = (plan.bulletOrder[exp.company] ?? []).filter((id) =>
      bulletsById.has(id)
    );
    const remaining = exp.bullets.filter((b) => !requestedOrder.includes(b.id));
    const orderedBullets = [
      ...requestedOrder.map((id) => bulletsById.get(id)!),
      ...remaining,
    ];

    const bullets = orderedBullets.map((bullet) => {
      let text = bullet.text;

      const proposed = plan.bulletRewrites?.[bullet.id];
      const approvedVocab = Object.values(bullet.synonyms ?? {}).flat();
      if (proposed && validateRewrite(bullet.text, proposed, approvedVocab).ok) {
        // A reworded bullet is used as-is; its synonym keys no longer match.
        return { ...bullet, text: proposed.trim() };
      }

      const choices = plan.phraseChoices[bullet.id];
      if (choices) {
        for (const [originalPhrase, chosenText] of Object.entries(choices)) {
          const allowed = bullet.synonyms[originalPhrase];
          if (
            allowed?.includes(chosenText) &&
            text.includes(originalPhrase)
          ) {
            text = text.replace(originalPhrase, chosenText);
          }
        }
      }
      return { ...bullet, text };
    });

    return { ...exp, bullets };
  });

  const skillsByCategory = new Map(resume.skills.map((s) => [s.category, s]));
  const orderedCategories = plan.skillsOrder.filter((c) =>
    skillsByCategory.has(c)
  );
  const remainingCategories = resume.skills.filter(
    (s) => !orderedCategories.includes(s.category)
  );
  const skills = [
    ...orderedCategories.map((c) => skillsByCategory.get(c)!),
    ...remainingCategories,
  ];

  return { ...resume, experience, skills };
}
