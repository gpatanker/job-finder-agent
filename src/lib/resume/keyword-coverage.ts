import type { ResumeData } from "@/lib/db/schema";
import { extractKeywords } from "@/lib/text/keywords";

export { extractKeywords };

// Cheap prefix-based stemming approximation (no external NLP dependency):
// two words are treated as the same underlying concept if they share the
// same first STEM_PREFIX_LENGTH characters and are both long enough that a
// shared prefix is a meaningful signal rather than a coincidence. Confirmed
// necessary live: "strategy" (JD keyword) vs "strategic" (resume wording),
// and "operations" (JD keyword) vs "operational"/"operating" (resume
// wording) were scored as misses under plain substring matching despite
// being the same skill.
const MIN_STEM_LENGTH = 6;
const STEM_PREFIX_LENGTH = 5;

function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < MIN_STEM_LENGTH || b.length < MIN_STEM_LENGTH) return false;
  return a.slice(0, STEM_PREFIX_LENGTH) === b.slice(0, STEM_PREFIX_LENGTH);
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);
}

// Job title and company were previously excluded here — a candidate whose
// actual title is "Business Operations Analyst" got zero credit for an
// "operations" JD keyword because it only ever appeared in the (unscored)
// title field, not in bullet prose. Bullet-level `keywords` (curated
// per-bullet tags, e.g. "vendor negotiation") and `synonyms` values (e.g.
// "leading vendor negotiations") are real, human-authored signal about
// what each bullet covers, phrased in ways that don't always literally
// appear in the bullet text itself — also previously excluded.
function buildResumeText(resume: ResumeData): string {
  return [
    ...resume.experience.flatMap((e) => [
      e.role,
      e.company,
      ...e.bullets.flatMap((b) => [
        b.text,
        ...b.keywords,
        ...Object.values(b.synonyms).flat(),
      ]),
    ]),
    ...resume.skills.flatMap((s) => [s.category, ...s.items]),
    ...resume.projects.flatMap((p) => [p.name, ...p.bullets]),
  ]
    .join(" ")
    .toLowerCase();
}

function isKeywordCovered(keyword: string, resumeText: string, resumeTokens: string[]): boolean {
  if (resumeText.includes(keyword)) return true;
  return resumeTokens.some((t) => wordsMatch(keyword, t));
}

/** 0-100 score: what fraction of the job description's top keywords show up in the resume (including close variants like "strategic" for "strategy"). */
export function scoreCoverage(resume: ResumeData, jobDescription: string): number {
  const jdKeywords = extractKeywords(jobDescription);
  if (jdKeywords.length === 0) return 100;

  const resumeText = buildResumeText(resume);
  const resumeTokens = tokenize(resumeText);

  const covered = jdKeywords.filter((kw) => isKeywordCovered(kw, resumeText, resumeTokens)).length;
  return Math.round((covered / jdKeywords.length) * 100);
}

export function missingKeywords(resume: ResumeData, jobDescription: string): string[] {
  const jdKeywords = extractKeywords(jobDescription);
  const resumeText = buildResumeText(resume);
  const resumeTokens = tokenize(resumeText);
  return jdKeywords.filter((kw) => !isKeywordCovered(kw, resumeText, resumeTokens));
}
