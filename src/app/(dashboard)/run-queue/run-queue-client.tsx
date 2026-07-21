"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, ClipboardList, Bot } from "lucide-react";
import type { AgentRunQueueItem } from "@/lib/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STATUS_TABS = ["all", "queued", "in_progress", "completed", "blocked", "cancelled"] as const;

const STATUS_LABELS: Record<string, string> = {
  all: "All",
  queued: "Queued",
  in_progress: "In Progress",
  completed: "Completed",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

const STATUS_VARIANTS: Record<string, NonNullable<BadgeProps["variant"]>> = {
  queued: "neutral",
  in_progress: "info",
  completed: "success",
  blocked: "danger",
  cancelled: "neutral",
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
    <Card data-testid={`run-${run.id}`}>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">
              {run.companySnapshot} — {run.titleSnapshot}
            </p>
            <p className="text-xs text-muted-foreground">
              Created {new Date(run.createdAt).toLocaleString()} ·{" "}
              {run.submitAuthorized ? "Submit authorized" : "Fill only, no submit"}
            </p>
          </div>
          <Badge variant={STATUS_VARIANTS[run.status] ?? "neutral"}>
            {STATUS_LABELS[run.status] ?? run.status}
          </Badge>
        </div>

        <p className="mt-2 line-clamp-3 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
          {run.brief}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" onClick={copyBrief}>
            <Copy className="h-3.5 w-3.5" /> Copy brief
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={`/packet/${run.jobId}`}>
              <ClipboardList className="h-3.5 w-3.5" /> Open packet
            </a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href="/apply-agent">
              <Bot className="h-3.5 w-3.5" /> Open apply agent
            </a>
          </Button>
          {run.status === "queued" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onUpdate(run.id, "in_progress")}
              data-testid={`mark-in-progress-${run.id}`}
            >
              Mark in progress
            </Button>
          )}
          {run.status === "in_progress" && (
            <Button
              variant="ghost"
              size="sm"
              className="text-success hover:text-success"
              onClick={() => onUpdate(run.id, "completed")}
              data-testid={`mark-completed-${run.id}`}
            >
              Mark completed
            </Button>
          )}
          {(run.status === "queued" || run.status === "in_progress") && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onUpdate(run.id, "blocked")}
                data-testid={`mark-blocked-${run.id}`}
              >
                Mark blocked
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onUpdate(run.id, "cancelled")}
                data-testid={`cancel-run-${run.id}`}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
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
      <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof STATUS_TABS)[number])}>
        <TabsList className="h-auto flex-wrap">
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t} value={t} data-testid={`run-queue-tab-${t}`}>
              {STATUS_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <Card>
          <CardContent
            className="py-12 text-center text-sm text-muted-foreground"
            data-testid="run-queue-empty"
          >
            Computer reads from this queue when you ask me to run queued applications.
          </CardContent>
        </Card>
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
