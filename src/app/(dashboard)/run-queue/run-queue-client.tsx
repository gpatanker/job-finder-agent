"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { AgentRunQueueItem } from "@/lib/db/schema";

const STATUS_TABS = ["all", "queued", "in_progress", "completed", "blocked", "cancelled"] as const;

const STATUS_LABELS: Record<string, string> = {
  all: "All",
  queued: "Queued",
  in_progress: "In Progress",
  completed: "Completed",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

const STATUS_BADGE: Record<string, string> = {
  queued: "bg-black/5 dark:bg-white/10",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  completed: "bg-green-500/15 text-green-700 dark:text-green-400",
  blocked: "bg-red-500/15 text-red-700 dark:text-red-400",
  cancelled: "bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50",
};

function RunCard({
  run,
  onUpdate,
}: {
  run: AgentRunQueueItem;
  onUpdate: (id: string, status: string) => Promise<void>;
}) {
  async function copyBrief() {
    await navigator.clipboard.writeText(run.brief ?? "");
    toast.success("Brief copied");
  }

  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/15" data-testid={`run-${run.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{run.companySnapshot} — {run.titleSnapshot}</p>
          <p className="text-xs text-black/50 dark:text-white/50">
            Created {new Date(run.createdAt).toLocaleString()} · {run.submitAuthorized ? "Submit authorized" : "Fill only, no submit"}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[run.status] ?? ""}`}>
          {STATUS_LABELS[run.status] ?? run.status}
        </span>
      </div>

      <p className="mt-2 line-clamp-3 whitespace-pre-wrap font-mono text-xs text-black/60 dark:text-white/60">
        {run.brief}
      </p>

      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <button onClick={copyBrief} className="hover:underline">Copy brief</button>
        <a href={`/packet/${run.jobId}`} className="hover:underline">Open packet</a>
        <a href={`/apply-agent`} className="hover:underline">Open apply agent</a>
        {run.status === "queued" && (
          <button onClick={() => onUpdate(run.id, "in_progress")} className="hover:underline" data-testid={`mark-in-progress-${run.id}`}>
            Mark in progress
          </button>
        )}
        {run.status === "in_progress" && (
          <button onClick={() => onUpdate(run.id, "completed")} className="text-green-700 hover:underline dark:text-green-400" data-testid={`mark-completed-${run.id}`}>
            Mark completed
          </button>
        )}
        {(run.status === "queued" || run.status === "in_progress") && (
          <>
            <button onClick={() => onUpdate(run.id, "blocked")} className="text-red-600 hover:underline dark:text-red-400" data-testid={`mark-blocked-${run.id}`}>
              Mark blocked
            </button>
            <button onClick={() => onUpdate(run.id, "cancelled")} className="text-black/50 hover:underline dark:text-white/50" data-testid={`cancel-run-${run.id}`}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function RunQueueClient({ initialRuns }: { initialRuns: AgentRunQueueItem[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]>("all");

  const filtered = useMemo(
    () => (tab === "all" ? runs : runs.filter((r) => r.status === tab)),
    [runs, tab]
  );

  async function handleUpdate(id: string, status: string) {
    try {
      const res = await fetch(`/api/agent-runs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update run");
      setRuns((rs) => rs.map((r) => (r.id === id ? body.run : r)));
      toast.success(`Run marked ${status}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update run");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-xs ${
              tab === t ? "bg-black text-white dark:bg-white dark:text-black" : "bg-black/5 dark:bg-white/10"
            }`}
            data-testid={`run-queue-tab-${t}`}
          >
            {STATUS_LABELS[t]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60" data-testid="run-queue-empty">
          Computer reads from this queue when you ask me to run queued applications.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((run) => (
            <RunCard key={run.id} run={run} onUpdate={handleUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}
