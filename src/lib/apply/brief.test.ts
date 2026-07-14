import { describe, expect, it } from "vitest";
import { buildApplyRunBrief } from "./brief";
import type { ApplicationQuestion, CandidateProfile, Job } from "@/lib/db/schema";

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
  location: "Austin, TX",
  currentCompany: "Example Corp",
  functionTags: [],
  preferredIndustries: [],
  workAuthorized: true,
  requiresSponsorship: false,
  education: [{ school: "State University", degree: "B.S." }],
  searchCriteria: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies CandidateProfile;

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
      approvedQuestions: [],
      submitAuthorized: false,
      resumeRoute: null,
    });
    expect(brief).toContain("No approved prompts on file");
  });
});
