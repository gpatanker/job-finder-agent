"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Search, Sparkles, ExternalLink, Check, X } from "lucide-react";
import type { JobSearchSuggestion } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export function SearchClient({
  initialSuggestions,
}: {
  initialSuggestions: JobSearchSuggestion[];
}) {
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [running, setRunning] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [scoring, setScoring] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  async function handleScoreUrl(e: FormEvent) {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setScoring(true);
    try {
      const res = await fetch("/api/search/score-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to score that posting");
      setSuggestions((s) => [body.suggestion, ...s]);
      setUrlInput("");
      toast.success(`${body.suggestion.company} — ${body.suggestion.title}: ${body.suggestion.matchScore}/100`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to score that posting");
    } finally {
      setScoring(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    try {
      const res = await fetch("/api/search/run", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      setSuggestions(body.suggestions);
      if (body.warning) toast.warning(body.warning);
      const notes = [
        body.skipped > 0 ? `${body.skipped} already known` : null,
        body.recovered > 0 ? `${body.recovered} recovered via direct company source` : null,
        body.filteredClosed > 0 ? `${body.filteredClosed} filtered as likely closed` : null,
        body.filteredGeneric > 0 ? `${body.filteredGeneric} filtered — link wasn't a specific posting` : null,
        body.filteredBlockedSource > 0
          ? `${body.filteredBlockedSource} filtered — source requires payment to apply`
          : null,
        body.filteredUnverifiable > 0
          ? `${body.filteredUnverifiable} filtered — couldn't verify (bot-blocked)`
          : null,
        body.filteredDiversityCap > 0
          ? `${body.filteredDiversityCap} filtered — too many from one company this run`
          : null,
      ].filter(Boolean);
      toast.success(
        `Found ${body.found}, added ${body.added} new suggestions${notes.length ? ` (${notes.join(", ")})` : ""}${
          body.widened ? " — broadened search after a thin first pass" : ""
        }`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    } finally {
      setRunning(false);
    }
  }

  async function handleClean() {
    setCleaning(true);
    try {
      const res = await fetch("/api/search/clean", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Cleanup failed");
      setSuggestions(body.suggestions);
      const notes = [
        body.recovered > 0 ? `${body.recovered} recovered via direct company source` : null,
        body.reasons?.closed > 0 ? `${body.reasons.closed} closed` : null,
        body.reasons?.generic > 0 ? `${body.reasons.generic} not a specific posting` : null,
        body.reasons?.blocked > 0 ? `${body.reasons.blocked} paywalled/blocked source` : null,
        body.reasons?.unverifiable > 0 ? `${body.reasons.unverifiable} couldn't verify` : null,
      ].filter(Boolean);
      toast.success(
        `Checked ${body.checked}, removed ${body.removed}${notes.length ? ` (${notes.join(", ")})` : ""}`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cleanup failed");
    } finally {
      setCleaning(false);
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
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleRun} disabled={running} data-testid="run-search-button">
          <Search className="h-4 w-4" />
          {running ? "Searching..." : "Find matching roles"}
        </Button>
        <Button
          variant="secondary"
          onClick={handleClean}
          disabled={cleaning || suggestions.length === 0}
          data-testid="clean-suggestions-button"
          title="Re-check every suggestion for closed/stale/blocked links and remove anything that no longer holds up"
        >
          {cleaning ? "Cleaning..." : "Clean up suggestions"}
        </Button>
      </div>

      <Card>
        <CardContent className="py-3">
          <form onSubmit={handleScoreUrl} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Label className="sr-only" htmlFor="score-url-input">
              Check a specific job posting
            </Label>
            <Input
              id="score-url-input"
              type="url"
              required
              placeholder="Paste a job posting URL to check your fit"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              data-testid="score-url-input"
            />
            <Button type="submit" variant="secondary" disabled={scoring} data-testid="score-url-button">
              <Sparkles className="h-4 w-4" />
              {scoring ? "Checking..." : "Check fit"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {suggestions.length === 0 ? (
        <Card>
          <CardContent
            className="py-12 text-center text-sm text-muted-foreground"
            data-testid="search-empty"
          >
            No suggestions yet. Click &ldquo;Find matching roles&rdquo; to search.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {suggestions.map((s) => (
            <Card key={s.id} data-testid={`suggestion-${s.id}`}>
              <CardContent className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {s.company} — {s.title}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {s.location ?? "—"} {s.workMode ? `(${s.workMode})` : ""} · {s.salaryText ?? "Salary n/a"}
                    </p>
                  </div>
                  <Badge variant="info">Match: {s.matchScore ?? "—"}/100</Badge>
                </div>
                {s.rationale && <p className="mt-2 text-sm text-muted-foreground">{s.rationale}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-1">
                  {s.applyUrl && (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={s.applyUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" /> Apply link
                      </a>
                    </Button>
                  )}
                  {s.sourceUrl && (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" /> Source
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-success hover:text-success"
                    onClick={() => handlePromote(s.id)}
                    data-testid={`promote-${s.id}`}
                  >
                    <Check className="h-3.5 w-3.5" /> Promote to pipeline
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDismiss(s.id)}>
                    <X className="h-3.5 w-3.5" /> Dismiss
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
