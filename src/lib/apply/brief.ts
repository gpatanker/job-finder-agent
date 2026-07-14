import type { ApplicationQuestion, CandidateProfile, Job, ResumeExperienceEntry } from "@/lib/db/schema";
import { formatExperienceSummary } from "./experience";

function formatSalary(job: Job): string {
  if (job.salaryText) return job.salaryText;
  if (job.salaryMin && job.salaryMax) return `$${job.salaryMin.toLocaleString()}–$${job.salaryMax.toLocaleString()}`;
  return "Not specified";
}

function formatEducation(profile: CandidateProfile): string {
  return profile.education.map((e) => `${e.degree}, ${e.school}`).join("; ");
}

function formatDemographics(profile: CandidateProfile): string {
  const fields: [string, string | null][] = [
    ["Gender identity", profile.genderIdentity],
    ["Race / ethnicity", profile.raceEthnicity],
    ["Sexual orientation", profile.sexualOrientation],
    ["Veteran status", profile.veteranStatus],
    ["Disability status", profile.disabilityStatus],
  ];
  return fields
    .map(([label, value]) =>
      value
        ? `- ${label}: ${value} (select the closest matching option; if none matches, select the closest option or "decline to answer")`
        : `- ${label}: Not on file — select "decline to answer" / "prefer not to answer" if the field is required`
    )
    .join("\n");
}

function residesInUnitedStates(profile: CandidateProfile): boolean {
  return /united states|\bUSA\b|\bU\.S\.?A?\.?\b/i.test(profile.location ?? "");
}

function formatExperienceLine(profile: CandidateProfile, experience: ResumeExperienceEntry[]): string {
  const resumeDerived = formatExperienceSummary(experience);

  if (profile.totalYearsExperience != null) {
    return (
      `- Total years of experience: ${profile.totalYearsExperience}+ years, self-reported by the candidate directly ` +
      `(the resume only reflects ~${resumeDerived} because it's tailored to relevant roles, not a full work history). ` +
      `For any "do you have at least N years of experience" question, compare N to this self-reported total and answer ` +
      `directly — Yes if N is at or below it, No if clearly above it. Only pause if the question's wording doesn't map ` +
      `cleanly onto this number (e.g. asks about a specific narrow domain the candidate may not have this much of).`
    );
  }

  return (
    `- Total professional experience (computed from resume dates only): ${resumeDerived}. No self-reported total is on ` +
    `file, and the resume may not reflect the candidate's full work history — for any "do you have at least N years of ` +
    `experience" question, do NOT answer automatically. Pause, show the user the threshold asked and this computed total, ` +
    `and ask how to answer.`
  );
}

function formatStructuredAnswers(
  profile: CandidateProfile,
  experience: ResumeExperienceEntry[],
  companyName: string
): string {
  const knownCompanies = experience.map((e) => e.company);
  const previouslyWorkedHere = knownCompanies.some(
    (c) => c.trim().toLowerCase() === companyName.trim().toLowerCase()
  );

  return [
    `- Resides in the United States: ${residesInUnitedStates(profile) ? "Yes" : "No — pause and confirm with the user before answering location/residency questions"}`,
    `- Requires relocation assistance: ${profile.requiresRelocationAssistance ? "Yes" : "No"}`,
    `- Highest level of education: ${profile.highestEducationLevel ?? "Not on file — pause and ask the user, or infer conservatively from the education list above"}`,
    `- Zip code of primary residence: ${profile.zipCode ?? "Not on file — pause and ask the user"}`,
    formatExperienceLine(profile, experience),
    `- Previously worked at ${companyName}: ${previouslyWorkedHere ? "Yes" : "No"} (based on the work-history company list: ${knownCompanies.join(", ") || "none on file"})`,
    `- "How did you hear about this opportunity?" default: ${profile.howHeardDefault ?? "Not on file — pause and ask the user"}`,
    `- AI-tool-use policy agreement (if the application asks you to agree not to use AI during interviews): ${profile.aiPolicyAgreement ?? "Not on file — pause and ask the user"}`,
  ].join("\n");
}

export function buildApplyRunBrief(params: {
  job: Job;
  profile: CandidateProfile;
  experience: ResumeExperienceEntry[];
  approvedQuestions: ApplicationQuestion[];
  submitAuthorized: boolean;
  resumeRoute: string | null;
}): string {
  const { job, profile, experience, approvedQuestions, submitAuthorized, resumeRoute } = params;

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

COMMON STRUCTURED FIELDS (dropdowns/short fields, not essay prompts — answer directly rather than pausing, except where noted)
${formatStructuredAnswers(profile, experience, job.company)}

OPTIONAL DEMOGRAPHIC / EEO QUESTIONS (only if the application asks — these are always optional under EEO law, never a reason to stop)
${formatDemographics(profile)}

APPROVED ANSWERS
${answersBlock}

OPERATING RULES FOR COMPUTER
1. Open the apply link and begin the application.
2. Upload the tailored resume PDF where a resume is requested.
3. Fill candidate basics and paste approved answers verbatim where they fit.
4. Use the common structured fields above for their matching dropdowns/short fields — pick the closest matching option the form actually offers, never a fabricated one.
5. For any field not covered above, pause and ask the user rather than guessing.
6. For any eligibility-gate question where the honest answer could disqualify the application (e.g. an experience-years threshold) and isn't a plain fact already given above, pause and ask the user how to answer — never decide this one yourself, in either direction.
7. If submit authorization is included, submit only if all required fields are covered and the application form matches the packet.`;
}
