"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { JobSearchSuggestion } from "@/lib/db/schema";

export function SearchClient({
  initialSuggestions,
}: {
  initialSuggestions: JobSearchSuggestion[];
}) {
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [running, setRunning] = useState(false);

  async function handleRun() {
    setRunning(true);
    try {
      const res = await fetch("/api/search/run", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      setSuggestions(body.suggestions);
      if (body.warning) toast.warning(body.warning);
      toast.success(`Found ${body.found}, added ${body.added} new suggestions (${body.skipped} already known)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    } finally {
      setRunning(false);
    }
  }

  async function handlePromote(id: string) {
    try {
      const res = await fetch(`/api/search/suggestions/${id}/promote`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to promote");
      setSuggestions((s) => s.filter((sug) => sug.id !== id));
      toast.success(`Promoted ${body.job.company} — ${body.job.title} to Pipeline`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to promote");
    }
  }

  async function handleDismiss(id: string) {
    try {
      const res = await fetch(`/api/search/suggestions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      });
      if (!res.ok) throw new Error("Failed to dismiss");
      setSuggestions((s) => s.filter((sug) => sug.id !== id));
      toast.success("Dismissed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to dismiss");
    }
  }

  return (
    <div className="space-y-4">
      <button
        onClick={handleRun}
        disabled={running}
        className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        data-testid="run-search-button"
      >
        {running ? "Searching..." : "Find matching roles"}
      </button>

      {suggestions.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60" data-testid="search-empty">
          No suggestions yet. Click &ldquo;Find matching roles&rdquo; to search.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="rounded-lg border border-black/10 p-4 dark:border-white/15"
              data-testid={`suggestion-${s.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{s.company} — {s.title}</p>
                  <p className="text-sm text-black/60 dark:text-white/60">
                    {s.location ?? "—"} {s.workMode ? `(${s.workMode})` : ""} · {s.salaryText ?? "Salary n/a"}
                  </p>
                </div>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
                  Match: {s.matchScore ?? "—"}/100
                </span>
              </div>
              {s.rationale && (
                <p className="mt-2 text-sm text-black/70 dark:text-white/70">{s.rationale}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                {s.applyUrl && (
                  <a href={s.applyUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    Apply link
                  </a>
                )}
                {s.sourceUrl && (
                  <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    Source
                  </a>
                )}
                <button
                  onClick={() => handlePromote(s.id)}
                  className="text-green-700 hover:underline dark:text-green-400"
                  data-testid={`promote-${s.id}`}
                >
                  Promote to pipeline
                </button>
                <button onClick={() => handleDismiss(s.id)} className="text-black/50 hover:underline dark:text-white/50">
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
