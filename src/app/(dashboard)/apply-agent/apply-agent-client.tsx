"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Circle, Copy, FileText, ClipboardList, Send, Ban } from "lucide-react";
import type { ApplicationQuestion, Job } from "@/lib/db/schema";
import { computeApplyChecklist, isChecklistComplete } from "@/lib/apply/readiness";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function ApplyAgentCard({
  job: initialJob,
  questions,
}: {
  job: Job;
  questions: ApplicationQuestion[];
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [submitAuthorized, setSubmitAuthorized] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [starting, setStarting] = useState(false);

  const checklist = computeApplyChecklist(job, questions);
  const complete = isChecklistComplete(checklist);

  async function toggleReviewConfirmed(next: boolean) {
    setJob((j) => ({ ...j, applyReviewConfirmed: next })); // optimistic; controlled checkbox would otherwise flicker back until the PATCH resolves
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applyReviewConfirmed: next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update");
      setJob(body.job);
    } catch (err) {
      setJob((j) => ({ ...j, applyReviewConfirmed: !next }));
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  }

  async function loadBrief() {
    setLoadingBrief(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/apply-brief?submitAuthorized=${submitAuthorized}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to build brief");
      setBrief(body.brief);
      setShowBrief(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to build brief");
    } finally {
      setLoadingBrief(false);
    }
  }

  async function handleStartRun() {
    setStarting(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/start-apply-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submitAuthorized }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to queue apply run");
      toast.success("Queued for Computer. You can now ask me: run my queued applications.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to queue apply run");
    } finally {
      setStarting(false);
    }
  }

  async function markStatus(status: string, applyAgentStatus?: string) {
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(applyAgentStatus ? { applyAgentStatus } : {}) }),
    });
    const body = await res.json();
    if (res.ok) {
      setJob(body.job);
      toast.success(`Status updated to ${status}`);
      router.refresh();
    }
  }

  async function copyBrief() {
    if (!brief) return;
    await navigator.clipboard.writeText(brief);
    toast.success("Brief copied");
  }

  return (
    <Card data-testid={`apply-card-${job.id}`}>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">
              {job.company} — {job.title}
            </p>
            <p className="text-sm text-muted-foreground">
              {job.location ?? "—"} · {job.sourcePlatform ?? "—"} · Match:{" "}
              {job.matchScore != null ? `${job.matchScore}/100` : "—"} · {job.salaryText ?? "Salary n/a"}
            </p>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" asChild>
              <a href={`/tailor/${job.id}`}>
                <FileText className="h-3.5 w-3.5" /> Tailor
              </a>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href={`/packet/${job.id}`}>
                <ClipboardList className="h-3.5 w-3.5" /> Packet
              </a>
            </Button>
          </div>
        </div>

        <ul className="mt-3 space-y-1.5 text-sm" data-testid={`checklist-${job.id}`}>
          {checklist.map((item) => (
            <li key={item.key} className="flex items-center gap-2">
              {item.met ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              {item.label}
            </li>
          ))}
        </ul>

        <div className="mt-3 flex items-center gap-2">
          <Checkbox
            id={`confirm-review-${job.id}`}
            checked={job.applyReviewConfirmed}
            onCheckedChange={(checked) => toggleReviewConfirmed(checked === true)}
            data-testid={`confirm-review-${job.id}`}
          />
          <Label htmlFor={`confirm-review-${job.id}`} className="font-normal">
            Work authorization & salary info confirmed
          </Label>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Checkbox
            id={`submit-authorized-${job.id}`}
            checked={submitAuthorized}
            onCheckedChange={(checked) => setSubmitAuthorized(checked === true)}
            data-testid={`submit-authorized-${job.id}`}
          />
          <Label htmlFor={`submit-authorized-${job.id}`} className="font-normal">
            Authorize Computer to submit after filling
          </Label>
        </div>
        <p className="ml-6 mt-1 text-xs text-muted-foreground">
          Leave unchecked and Computer will fill the form, then stop at the final review screen for your approval.
          This dashboard never submits an application itself.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadBrief}
            disabled={loadingBrief}
            data-testid={`preview-brief-${job.id}`}
          >
            {loadingBrief ? "Loading..." : "Preview brief"}
          </Button>
          <Button
            size="sm"
            onClick={handleStartRun}
            disabled={!complete || starting}
            data-testid={`start-apply-run-${job.id}`}
            title={!complete ? "Complete the checklist above first" : undefined}
          >
            <Send className="h-3.5 w-3.5" />
            {starting ? "Queueing..." : "Start Apply Run"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => markStatus("ready_to_apply")}>
            Mark ready only
          </Button>
          <Button variant="outline" size="sm" onClick={() => markStatus("applied", "submitted")}>
            Mark submitted
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => markStatus("blocked", "blocked")}
          >
            <Ban className="h-3.5 w-3.5" /> Block
          </Button>
        </div>

        {!complete && (
          <p className="mt-2 text-xs text-warning">
            Missing: {checklist.filter((c) => !c.met).map((c) => c.label).join(", ")}
          </p>
        )}

        {showBrief && brief && (
          <div className="mt-3 space-y-2">
            <Textarea
              readOnly
              value={brief}
              className="h-64 font-mono text-xs"
              data-testid={`brief-text-${job.id}`}
            />
            <Button variant="ghost" size="sm" onClick={copyBrief}>
              <Copy className="h-3.5 w-3.5" /> Copy brief
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ApplyAgentClient({
  jobs,
  questionsByJob,
}: {
  jobs: Job[];
  questionsByJob: Record<string, ApplicationQuestion[]>;
}) {
  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent
          className="py-12 text-center text-sm text-muted-foreground"
          data-testid="apply-agent-empty"
        >
          No jobs yet. Add one in Pipeline first.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {jobs.map((job) => (
        <ApplyAgentCard key={job.id} job={job} questions={questionsByJob[job.id] ?? []} />
      ))}
    </div>
  );
}
