import type { ResumeData } from "@/lib/db/schema";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "are", "will", "have",
  "has", "this", "that", "from", "into", "who", "what", "when", "where",
  "why", "how", "all", "any", "can", "may", "must", "should", "would",
  "job", "role", "team", "work", "years", "year", "experience", "including",
  "such", "etc", "able", "strong", "using", "used", "use", "including",
  "across", "within", "about", "other", "than", "also", "more", "most",
  "we're", "we", "they", "their", "them", "its", "it's", "on", "in", "to",
  "of", "a", "an", "is", "as", "at", "by", "or", "be", "not",
]);

export function extractKeywords(text: string, limit = 40): string[] {
  const counts = new Map<string, number>();
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9+.\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}

/** 0-100 score: what fraction of the job description's top keywords show up in the resume. */
export function scoreCoverage(resume: ResumeData, jobDescription: string): number {
  const jdKeywords = extractKeywords(jobDescription);
  if (jdKeywords.length === 0) return 100;

  const resumeText = [
    ...resume.experience.flatMap((e) => e.bullets.map((b) => b.text)),
    ...resume.skills.flatMap((s) => s.items),
    ...resume.projects.flatMap((p) => p.bullets),
  ]
    .join(" ")
    .toLowerCase();

  const covered = jdKeywords.filter((kw) => resumeText.includes(kw)).length;
  return Math.round((covered / jdKeywords.length) * 100);
}

export function missingKeywords(resume: ResumeData, jobDescription: string): string[] {
  const jdKeywords = extractKeywords(jobDescription);
  const resumeText = [
    ...resume.experience.flatMap((e) => e.bullets.map((b) => b.text)),
    ...resume.skills.flatMap((s) => s.items),
  ]
    .join(" ")
    .toLowerCase();
  return jdKeywords.filter((kw) => !resumeText.includes(kw));
}
