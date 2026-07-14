import type { ApplicationQuestion, CandidateProfile, Job } from "@/lib/db/schema";

function formatSalary(job: Job): string {
  if (job.salaryText) return job.salaryText;
  if (job.salaryMin && job.salaryMax) return `$${job.salaryMin.toLocaleString()}–$${job.salaryMax.toLocaleString()}`;
  return "Not specified";
}

function formatEducation(profile: CandidateProfile): string {
  return profile.education.map((e) => `${e.degree}, ${e.school}`).join("; ");
}

export function buildApplyRunBrief(params: {
  job: Job;
  profile: CandidateProfile;
  approvedQuestions: ApplicationQuestion[];
  submitAuthorized: boolean;
  resumeRoute: string | null;
}): string {
  const { job, profile, approvedQuestions, submitAuthorized, resumeRoute } = params;

  const submitBlock = submitAuthorized
    ? "SUBMIT AUTHORIZATION: The user has explicitly authorized you to submit this application. You may complete the final submit step."
    : "DO NOT SUBMIT: Fill the form using the details below, then STOP at the final review screen and report back. Do NOT click final submit. The user has not authorized submission.";

  const answersBlock =
    approvedQuestions.length > 0
      ? approvedQuestions.map((q) => `Q: ${q.prompt}\nA: ${q.answer ?? ""}`).join("\n\n")
      : "(No approved prompts on file for this application.)";

  return `COMPUTER APPLY RUN BRIEF
========================
${submitBlock}

ROLE
- Company: ${job.company}
- Title: ${job.title}
- Location: ${job.location ?? "Not specified"}
- Source / platform: ${job.sourcePlatform ?? "Not specified"}
- Match score: ${job.matchScore != null ? `${job.matchScore}/100` : "Not specified"}
- Salary: ${formatSalary(job)}

APPLY LINK
${job.applyUrl ?? "Not on file"}

RESUME
- Tailored resume: ${job.tailoredResumeFileName ?? "Not generated"}
- Resume PDF route: ${resumeRoute ?? "Not generated"}

CANDIDATE BASICS
- Name: ${profile.name}
- Email: ${profile.email}
- Phone: ${profile.phone ?? "Not on file"}
- LinkedIn: ${profile.linkedin ?? "Not on file"}
- Education: ${formatEducation(profile)}
- Work authorization: ${profile.workAuthorized ? "Yes, legally authorized to work in the United States" : "Not authorized — pause and ask the user"}
- Sponsorship: ${profile.requiresSponsorship ? "Yes, will now or in the future require visa sponsorship" : "No sponsorship required"}
- Optional demographics: leave blank if possible; if required, select decline / I do not wish to answer.

APPROVED ANSWERS
${answersBlock}

OPERATING RULES FOR COMPUTER
1. Open the apply link and begin the application.
2. Upload the tailored resume PDF where a resume is requested.
3. Fill candidate basics and paste approved answers verbatim where they fit.
4. For any field not covered above, pause and ask the user rather than guessing.
5. If submit authorization is included, submit only if all required fields are covered and the application form matches the packet.`;
}
