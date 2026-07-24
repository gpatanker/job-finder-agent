import { describe, expect, it } from "vitest";
import { computeApplyChecklist, isChecklistComplete } from "./readiness";
import type { ApplicationQuestion, Job } from "@/lib/db/schema";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    company: "Acme",
    title: "Analyst",
    team: null,
    location: null,
    workMode: null,
    sourcePlatform: null,
    applyUrl: "https://example.com/apply",
    jobDescription: null,
    salaryMin: null,
    salaryMax: null,
    salaryText: null,
    matchScore: null,
    status: "discovered",
    approvalStatus: "pending",
    applyAgentStatus: null,
    roleFamily: null,
    resumeAngle: null,
    isSample: false,
    tailoredResumeSlug: "acme-analyst-job-1",
    tailoredResumeFileName: "acme-analyst-job-1.pdf",
    tailoredResumeGeneratedAt: new Date(),
    tailoringPlan: null,
    resumeCoverageScore: null,
    applicationPromptsScannedAt: new Date(),
    applyReviewConfirmed: true,
    appliedAt: null,
    blockReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeQuestion(status: string): ApplicationQuestion {
  return {
    id: "q-1",
    jobId: "job-1",
    prompt: "Why this role?",
    answer: "Because...",
    status,
    source: "manual",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("computeApplyChecklist", () => {
  it("is complete when every item is satisfied and there are no prompts", () => {
    const checklist = computeApplyChecklist(makeJob(), []);
    expect(isChecklistComplete(checklist)).toBe(true);
  });

  it("is incomplete when the resume hasn't been generated", () => {
    const checklist = computeApplyChecklist(makeJob({ tailoredResumeSlug: null }), []);
    expect(isChecklistComplete(checklist)).toBe(false);
    expect(checklist.find((c) => c.key === "resume")?.met).toBe(false);
  });

  it("is incomplete when prompts exist but aren't all approved", () => {
    const checklist = computeApplyChecklist(makeJob(), [makeQuestion("needs_draft")]);
    expect(isChecklistComplete(checklist)).toBe(false);
    expect(checklist.find((c) => c.key === "prompts_approved")?.met).toBe(false);
  });

  it("is complete when all prompts are approved or submitted", () => {
    const checklist = computeApplyChecklist(makeJob(), [
      makeQuestion("approved"),
      makeQuestion("submitted"),
    ]);
    expect(isChecklistComplete(checklist)).toBe(true);
  });

  it("is incomplete when work-auth/salary review isn't confirmed", () => {
    const checklist = computeApplyChecklist(makeJob({ applyReviewConfirmed: false }), []);
    expect(isChecklistComplete(checklist)).toBe(false);
  });
});
