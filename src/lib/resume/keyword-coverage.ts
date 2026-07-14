import type { ResumeData } from "@/lib/db/schema";
import { extractKeywords } from "@/lib/text/keywords";

export { extractKeywords };

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
