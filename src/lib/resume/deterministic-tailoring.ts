import type { ResumeData } from "@/lib/db/schema";
import { extractKeywords } from "./keyword-coverage";
import { emptyTailoringPlan, type TailoringPlan } from "./types";

function overlapScore(text: string, jdKeywords: string[]): number {
  const lower = text.toLowerCase();
  return jdKeywords.reduce((score, kw) => score + (lower.includes(kw) ? 1 : 0), 0);
}

/**
 * No LLM call: ranks existing bullets/skills by keyword-overlap with the job
 * description. Used when the Claude-backed agent is unavailable or fails
 * validation — a worse ordering is an acceptable fallback, fabricated text
 * is not.
 */
export function deterministicTailoringPlan(
  resume: ResumeData,
  jobDescription: string
): TailoringPlan {
  const plan = emptyTailoringPlan();
  const jdKeywords = extractKeywords(jobDescription);

  if (jdKeywords.length === 0) return plan;

  for (const exp of resume.experience) {
    const ranked = exp.bullets
      .map((b, index) => ({
        id: b.id,
        index,
        score: overlapScore(b.text + " " + b.keywords.join(" "), jdKeywords),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    plan.bulletOrder[exp.company] = ranked.map((r) => r.id);
  }

  const rankedSkills = resume.skills
    .map((s, index) => ({
      category: s.category,
      index,
      score: overlapScore(s.items.join(" "), jdKeywords),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  plan.skillsOrder = rankedSkills.map((r) => r.category);

  plan.rationale =
    "Deterministic keyword-overlap ordering (Claude tailoring unavailable or fell back).";

  return plan;
}
