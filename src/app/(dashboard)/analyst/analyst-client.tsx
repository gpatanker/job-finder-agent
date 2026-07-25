"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Lightbulb } from "lucide-react";
import type { AnalystReport, AnalystRecommendation } from "@/lib/db/schema";
import type { AnalystEligibility } from "@/lib/analyst/eligibility";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const CATEGORY_LABELS: Record<AnalystRecommendation["category"], string> = {
  job_search: "Job Search",
  resume_tailoring: "Resume Tailoring",
  cost: "Cost",
  process: "Process",
  other: "Other",
};

const TRIGGER_LABELS: Record<string, string> = {
  new_interview: "New interview",
  application_batch: "New application batch",
  manual: "Manually requested",
};

export function AnalystClient({
  initialReports,
  initialEligibility,
}: {
  initialReports: AnalystReport[];
  initialEligibility: AnalystEligibility;
}) {
  const [reports, setReports] = useState(initialReports);
  const [eligibility, setEligibility] = useState(initialEligibility);
  const [running, setRunning] = useState(false);

  async function handleRun(force: boolean) {
    setRunning(true);
    try {
      const res = await fetch("/api/analyst/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Analyst run failed");
      if (!body.ran) {
        toast.info(body.eligibility?.detail ?? "Not enough new signal yet.");
        setEligibility(body.eligibility);
        return;
      }
      setReports((r) => [body.report, ...r]);
      toast.success("Pipeline Analyst report ready");
      const refreshed = await fetch("/api/analyst").then((r) => r.json());
      setEligibility(refreshed.eligibility);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analyst run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2">
            <Badge variant={eligibility.eligible ? "success" : "neutral"}>
              {eligibility.eligible ? "Eligible to run" : "Not eligible yet"}
            </Badge>
            <p className="text-sm text-muted-foreground">{eligibility.detail}</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => handleRun(false)}
              disabled={running || !eligibility.eligible}
              data-testid="run-analyst-button"
            >
              <Sparkles className="h-4 w-4" />
              {running ? "Analyzing..." : "Run Analyst"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleRun(true)}
              disabled={running}
              data-testid="force-run-analyst-button"
              title="Run now regardless of eligibility"
            >
              Force run
            </Button>
          </div>
        </CardContent>
      </Card>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground" data-testid="analyst-empty">
            No reports yet. Run the Analyst once there&apos;s enough signal — or force a first run now.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {reports.map((report) => (
            <Card key={report.id} data-testid={`analyst-report-${report.id}`}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    {new Date(report.createdAt).toLocaleString()}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="info">{TRIGGER_LABELS[report.triggerReason] ?? report.triggerReason}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {report.jobsAnalyzedCount} jobs analyzed
                      {report.estimatedCostUsd != null ? ` · $${report.estimatedCostUsd.toFixed(3)}` : ""}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm">{report.summary}</p>
                <div className="flex flex-col gap-2">
                  {report.recommendations.map((rec, i) => (
                    <div key={i} className="flex gap-2 rounded-md border border-border p-3 text-sm">
                      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                      <div>
                        <p className="font-medium">
                          {rec.title}{" "}
                          <Badge variant="outline" className="ml-1">
                            {CATEGORY_LABELS[rec.category] ?? rec.category}
                          </Badge>
                        </p>
                        <p className="text-muted-foreground">{rec.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
