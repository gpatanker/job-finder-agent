"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Sparkles } from "lucide-react";
import type { Job, ResumeData } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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
      <Card>
        <CardContent
          className="py-8 text-sm text-muted-foreground"
          data-testid="tailor-no-base-resume"
        >
          No base resume seeded yet. Go to Settings → Resume, or fill in{" "}
          <code className="rounded bg-secondary px-1 py-0.5">local/resume.seed.json</code>{" "}
          and run <code className="rounded bg-secondary px-1 py-0.5">npm run db:seed-profile</code>.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title={`${job.company} — ${job.title}`}
        description={`${job.location ?? "—"} ${job.workMode ? `(${job.workMode})` : ""}`}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <Button onClick={handleGenerate} disabled={pending} data-testid="generate-resume-button">
            <Sparkles className="h-4 w-4" />
            {pending
              ? "Generating..."
              : job.tailoredResumeSlug
                ? "Regenerate & attach PDF"
                : "Generate & attach PDF"}
          </Button>

          {job.tailoredResumeSlug && (
            <Button variant="outline" asChild>
              <a
                href={`/api/resumes/${job.tailoredResumeSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="download-resume-link"
              >
                <Download className="h-4 w-4" />
                Download PDF
              </a>
            </Button>
          )}

          {job.resumeCoverageScore != null && (
            <Badge variant="info">Coverage: {job.resumeCoverageScore}/100</Badge>
          )}
        </CardContent>
      </Card>

      {job.tailoredResumeSlug ? (
        <p className="text-xs text-muted-foreground">
          Resume source: Generated from your base resume + role keywords. Generated{" "}
          {job.tailoredResumeGeneratedAt
            ? new Date(job.tailoredResumeGeneratedAt).toLocaleString()
            : ""}
          .
        </p>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="tailor-not-generated">
          No resume generated yet for this job.
        </p>
      )}

      {job.tailoringPlan && (
        <Card>
          <CardHeader>
            <CardTitle>What changed vs. your base resume</CardTitle>
          </CardHeader>
          <CardContent>
            <DiffView resume={resume} plan={job.tailoringPlan} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
