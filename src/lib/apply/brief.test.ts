import { describe, expect, it } from "vitest";
import { buildApplyRunBrief } from "./brief";
import type {
  ApplicationQuestion,
  CandidateProfile,
  Job,
  ResumeExperienceEntry,
} from "@/lib/db/schema";

const job = {
  id: "job-1",
  company: "Acme",
  title: "Analyst",
  team: null,
  location: "Remote",
  workMode: "remote",
  sourcePlatform: "Greenhouse",
  applyUrl: "https://example.com/apply",
  jobDescription: null,
  salaryMin: null,
  salaryMax: null,
  salaryText: "$120k-$140k",
  matchScore: 90,
  status: "queued",
  approvalStatus: "approved",
  applyAgentStatus: null,
  roleFamily: null,
  resumeAngle: null,
  isSample: false,
  tailoredResumeSlug: "acme-analyst",
  tailoredResumeFileName: "acme-analyst.pdf",
  tailoredResumeGeneratedAt: new Date(),
  tailoringPlan: null,
  resumeCoverageScore: null,
  applicationPromptsScannedAt: new Date(),
  applyReviewConfirmed: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies Job;

const profile = {
  id: "profile-1",
  name: "Jordan Example",
  email: "jordan@example.com",
  phone: "555-0100",
  linkedin: "https://linkedin.com/in/jordan",
  location: "Austin, TX, United States",
  currentCompany: "Example Corp",
  functionTags: [],
  preferredIndustries: [],
  workAuthorized: true,
  requiresSponsorship: false,
  genderIdentity: null,
  raceEthnicity: null,
  sexualOrientation: null,
  veteranStatus: null,
  disabilityStatus: null,
  zipCode: null,
  highestEducationLevel: null,
  requiresRelocationAssistance: false,
  howHeardDefault: null,
  aiPolicyAgreement: null,
  education: [{ school: "State University", degree: "B.S." }],
  searchCriteria: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies CandidateProfile;

const experience: ResumeExperienceEntry[] = [
  {
    company: "Example Corp",
    role: "Analyst",
    dateRange: "Jan 2022 – Present",
    bullets: [],
  },
];

const approvedQuestion = {
  id: "q-1",
  jobId: "job-1",
  prompt: "Why this role?",
  answer: "Because of the mission.",
  status: "approved",
  source: "manual",
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies ApplicationQuestion;

describe("buildApplyRunBrief", () => {
  it("includes the DO NOT SUBMIT block when submitAuthorized is false", () => {
    const brief = buildApplyRunBrief({
      job,
      profile,
      experience,
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: "/api/resumes/acme-analyst",
    });
    expect(brief).toContain("DO NOT SUBMIT");
    expect(brief).not.toContain("SUBMIT AUTHORIZATION: The user has explicitly");
  });

  it("includes the submit-authorized block when true", () => {
    const brief = buildApplyRunBrief({
      job,
      profile,
      experience,
      approvedQuestions: [],
      submitAuthorized: true,
      resumeRoute: "/api/resumes/acme-analyst",
    });
    expect(brief).toContain("The user has explicitly authorized you to submit");
  });

  it("includes candidate basics and the resume route", () => {
    const brief = buildApplyRunBrief({
      job,
      profile,
      experience,
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: "/api/resumes/acme-analyst",
    });
    expect(brief).toContain("Jordan Example");
    expect(brief).toContain("jordan@example.com");
    expect(brief).toContain("/api/resumes/acme-analyst");
  });

  it("includes approved answers verbatim", () => {
    const brief = buildApplyRunBrief({
      job,
      profile,
      experience,
      approvedQuestions: [approvedQuestion],
      submitAuthorized: false,
      resumeRoute: null,
    });
    expect(brief).toContain("Why this role?");
    expect(brief).toContain("Because of the mission.");
  });

  it("says no approved prompts when there are none", () => {
    const brief = buildApplyRunBrief({
      job,
      profile,
      experience,
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: null,
    });
    expect(brief).toContain("No approved prompts on file");
  });

  it("tells the automation to decline demographic questions when none are on file", () => {
    const brief = buildApplyRunBrief({
      job,
      profile,
      experience,
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: null,
    });
    expect(brief).toContain('Gender identity: Not on file — select "decline to answer"');
  });

  it("passes through real self-identification values when set, for the automation to match against the form's own options", () => {
    const brief = buildApplyRunBrief({
      job,
      profile: {
        ...profile,
        genderIdentity: "Woman",
        raceEthnicity: "White; not Hispanic or Latino",
        sexualOrientation: "Bisexual",
        veteranStatus: "Protected veteran",
        disabilityStatus: "Yes, I have a disability",
      },
      experience,
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: null,
    });
    expect(brief).toContain("Gender identity: Woman");
    expect(brief).toContain("Race / ethnicity: White; not Hispanic or Latino");
    expect(brief).toContain("Sexual orientation: Bisexual");
    expect(brief).toContain("Veteran status: Protected veteran");
    expect(brief).toContain("Disability status: Yes, I have a disability");
  });

  it("never auto-answers an experience-years threshold question — always instructs a pause instead", () => {
    const brief = buildApplyRunBrief({
      job,
      profile,
      experience,
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: null,
    });
    expect(brief).toContain("do NOT answer automatically");
    expect(brief).toContain("Pause, show the user the threshold asked and this computed total");
  });

  it("detects that the candidate has previously worked at the company being applied to", () => {
    const brief = buildApplyRunBrief({
      job: { ...job, company: "Example Corp" },
      profile,
      experience,
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: null,
    });
    expect(brief).toContain("Previously worked at Example Corp: Yes");
  });

  it("says no when the company being applied to isn't in the work history", () => {
    const brief = buildApplyRunBrief({
      job: { ...job, company: "Some New Company" },
      profile,
      experience,
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: null,
    });
    expect(brief).toContain("Previously worked at Some New Company: No");
  });

  it("flags common structured fields as not-on-file when unset, rather than guessing", () => {
    const brief = buildApplyRunBrief({
      job,
      profile,
      experience,
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: null,
    });
    expect(brief).toContain("Zip code of primary residence: Not on file");
    expect(brief).toContain('"How did you hear about this opportunity?" default: Not on file');
  });
});
