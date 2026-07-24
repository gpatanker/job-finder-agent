import { describe, expect, it } from "vitest";
import { buildApplyRunBrief } from "./brief";
import type {
  ApplicationQuestion,
  CandidateProfile,
  Job,
  PlatformFieldMapping,
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
  appliedAt: null,
  blockReason: null,
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
  totalYearsExperience: null,
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
      knownFieldMappings: [],
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
      knownFieldMappings: [],
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
      knownFieldMappings: [],
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
      knownFieldMappings: [],
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
      knownFieldMappings: [],
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
      knownFieldMappings: [],
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
      knownFieldMappings: [],
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

  it("pauses on an experience-years threshold question when no self-reported total is on file", () => {
    const brief = buildApplyRunBrief({
      job,
      profile,
      experience,
      knownFieldMappings: [],
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: null,
    });
    expect(brief).toContain("do NOT answer automatically");
    expect(brief).toContain("Pause, show the user the threshold asked and this computed total");
  });

  it(
    "regression: uses the candidate's self-reported total experience to answer threshold questions directly " +
      "once it's on file, instead of pausing (the resume intentionally lists only relevant roles and can " +
      "understate real total experience — e.g. resume shows ~2 years here but the candidate reported 8+)",
    () => {
      const brief = buildApplyRunBrief({
        job,
        profile: { ...profile, totalYearsExperience: 8 },
        experience,
        knownFieldMappings: [],
        approvedQuestions: [],
        submitAuthorized: false,
        resumeRoute: null,
      });
      expect(brief).toContain("Total years of experience: 8+ years, self-reported by the candidate directly");
      expect(brief).toContain("compare N to this self-reported total and answer directly");
      expect(brief).not.toContain("do NOT answer automatically");
    }
  );

  it("detects that the candidate has previously worked at the company being applied to", () => {
    const brief = buildApplyRunBrief({
      job: { ...job, company: "Example Corp" },
      profile,
      experience,
      knownFieldMappings: [],
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
      knownFieldMappings: [],
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
      knownFieldMappings: [],
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: null,
    });
    expect(brief).toContain("Zip code of primary residence: Not on file");
    expect(brief).toContain('"How did you hear about this opportunity?" default: Not on file');
  });

  it("says no mappings are known yet for a platform with none on file", () => {
    const brief = buildApplyRunBrief({
      job,
      profile,
      experience,
      knownFieldMappings: [],
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: null,
    });
    expect(brief).toContain("None learned for this platform yet");
  });

  it(
    "regression: surfaces learned platform field mappings directly so the Computer doesn't have to " +
      "rediscover a dropdown's options on every application on that platform",
    () => {
      const mapping: PlatformFieldMapping = {
        id: "map-1",
        platform: "greenhouse",
        questionPattern: "how did you hear about this opportunity",
        answerValue: "LinkedIn Jobs",
        notes: "falls back to closest LinkedIn-flavored option if exact label differs",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const brief = buildApplyRunBrief({
        job,
        profile,
        experience,
        knownFieldMappings: [mapping],
        approvedQuestions: [],
        submitAuthorized: false,
        resumeRoute: null,
      });
      expect(brief).toContain('"how did you hear about this opportunity"');
      expect(brief).toContain("LinkedIn Jobs");
      expect(brief).toContain("falls back to closest LinkedIn-flavored option");
    }
  );
});
