"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ApplicationQuestion, Job } from "@/lib/db/schema";
import { computeApplyChecklist, isChecklistComplete } from "@/lib/apply/readiness";

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

  async function toggleReviewConfirmed() {
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applyReviewConfirmed: !job.applyReviewConfirmed }),
    });
    const body = await res.json();
    if (res.ok) setJob(body.job);
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
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/15" data-testid={`apply-card-${job.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{job.company} — {job.title}</p>
          <p className="text-sm text-black/60 dark:text-white/60">
            {job.location ?? "—"} · {job.sourcePlatform ?? "—"} · Match:{" "}
            {job.matchScore != null ? `${job.matchScore}/100` : "—"} · {job.salaryText ?? "Salary n/a"}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <a href={`/tailor/${job.id}`} className="hover:underline">Tailor</a>
          <a href={`/packet/${job.id}`} className="hover:underline">Packet</a>
        </div>
      </div>

      <ul className="mt-3 space-y-1 text-sm" data-testid={`checklist-${job.id}`}>
        {checklist.map((item) => (
          <li key={item.key} className="flex items-center gap-2">
            <span className={item.met ? "text-green-600 dark:text-green-400" : "text-black/40 dark:text-white/40"}>
              {item.met ? "✓" : "○"}
            </span>
            {item.label}
          </li>
        ))}
      </ul>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={job.applyReviewConfirmed} onChange={toggleReviewConfirmed} data-testid={`confirm-review-${job.id}`} />
        Work authorization & salary info confirmed
      </label>

      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={submitAuthorized}
          onChange={(e) => setSubmitAuthorized(e.target.checked)}
          data-testid={`submit-authorized-${job.id}`}
        />
        Authorize Computer to submit after filling
      </label>
      <p className="ml-6 text-xs text-black/50 dark:text-white/50">
        Leave unchecked and Computer will fill the form, then stop at the final review screen for your approval.
        This dashboard never submits an application itself.
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <button
          onClick={loadBrief}
          disabled={loadingBrief}
          className="rounded-md border border-black/15 px-3 py-2 text-xs dark:border-white/20"
          data-testid={`preview-brief-${job.id}`}
        >
          {loadingBrief ? "Loading..." : "Preview brief"}
        </button>
        <button
          onClick={handleStartRun}
          disabled={!complete || starting}
          className="rounded-md bg-black px-3 py-2 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
          data-testid={`start-apply-run-${job.id}`}
          title={!complete ? "Complete the checklist above first" : undefined}
        >
          {starting ? "Queueing..." : "Start Apply Run"}
        </button>
        <button onClick={() => markStatus("ready_to_apply")} className="rounded-md border border-black/15 px-3 py-2 text-xs dark:border-white/20">
          Mark ready only
        </button>
        <button onClick={() => markStatus("applied", "submitted")} className="rounded-md border border-black/15 px-3 py-2 text-xs dark:border-white/20">
          Mark submitted
        </button>
        <button onClick={() => markStatus("blocked", "blocked")} className="rounded-md border border-black/15 px-3 py-2 text-xs text-red-600 dark:border-white/20 dark:text-red-400">
          Block
        </button>
      </div>

      {!complete && (
        <p className="mt-2 text-xs text-yellow-700 dark:text-yellow-400">
          Missing: {checklist.filter((c) => !c.met).map((c) => c.label).join(", ")}
        </p>
      )}

      {showBrief && brief && (
        <div className="mt-3 space-y-2">
          <textarea
            readOnly
            value={brief}
            className="h-64 w-full rounded-md border border-black/15 bg-transparent p-2 font-mono text-xs dark:border-white/20"
            data-testid={`brief-text-${job.id}`}
          />
          <button onClick={copyBrief} className="text-xs hover:underline">Copy brief</button>
        </div>
      )}
    </div>
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
      <p className="text-sm text-black/60 dark:text-white/60" data-testid="apply-agent-empty">
        No jobs yet. Add one in Pipeline first.
      </p>
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
