import type { ResumeData } from "@/lib/db/schema";
import type { TailoringPlan } from "./types";

/**
 * Applies a tailoring plan to base resume data. Only ever reorders existing
 * bullets/skills and swaps in synonym text that is literally present in that
 * bullet's pre-approved `synonyms` map — anything else in the plan is
 * silently ignored rather than applied, so a malformed or malicious plan can
 * never introduce fabricated text.
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
