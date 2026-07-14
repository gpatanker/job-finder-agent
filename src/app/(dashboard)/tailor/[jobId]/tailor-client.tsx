"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { Job, ResumeData } from "@/lib/db/schema";
import { DiffView } from "../diff-view";

export function TailorClient({
  job: initialJob,
  resume,
}: {
  job: Job;
  resume: ResumeData | null;
}) {
  const [job, setJob] = useState(initialJob);
  const [pending, setPending] = useState(false);

  async function handleGenerate() {
    setPending(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/generate-resume`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to generate resume");
      setJob(body.job);
      toast.success(
        `Resume generated and attached (coverage: ${body.plan.coverageScore ?? "n/a"}/100)`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate resume");
    } finally {
      setPending(false);
    }
  }

  if (!resume) {
    return (
      <p className="text-sm text-black/60 dark:text-white/60" data-testid="tailor-no-base-resume">
        No base resume seeded yet. Go to Settings → Resume, or fill in{" "}
        <code className="rounded bg-black/5 px-1 dark:bg-white/10">local/resume.seed.json</code>{" "}
        and run <code className="rounded bg-black/5 px-1 dark:bg-white/10">npm run db:seed-profile</code>.
      </p>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">
          {job.company} — {job.title}
        </h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          {job.location ?? "—"} {job.workMode ? `(${job.workMode})` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={pending}
          className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          data-testid="generate-resume-button"
        >
          {pending
            ? "Generating..."
            : job.tailoredResumeSlug
              ? "Regenerate & attach PDF"
              : "Generate & attach PDF"}
        </button>

        {job.tailoredResumeSlug && (
          <a
            href={`/api/resumes/${job.tailoredResumeSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm hover:underline"
            data-testid="download-resume-link"
          >
            Download PDF
          </a>
        )}

        {job.resumeCoverageScore != null && (
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
            Coverage: {job.resumeCoverageScore}/100
          </span>
        )}
      </div>

      {job.tailoredResumeSlug ? (
        <p className="text-xs text-black/50 dark:text-white/50">
          Resume source: Generated from your base resume + role keywords. Generated{" "}
          {job.tailoredResumeGeneratedAt
            ? new Date(job.tailoredResumeGeneratedAt).toLocaleString()
            : ""}
          .
        </p>
      ) : (
        <p className="text-sm text-black/60 dark:text-white/60" data-testid="tailor-not-generated">
          No resume generated yet for this job.
        </p>
      )}

      {job.tailoringPlan && (
        <div>
          <h2 className="mb-2 text-sm font-medium">
            What changed vs. your base resume
          </h2>
          <DiffView resume={resume} plan={job.tailoringPlan} />
        </div>
      )}
    </div>
  );
}
