"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Sparkles, Check, Trash2, ScanLine, Plus } from "lucide-react";
import type { ApplicationQuestion, Job } from "@/lib/db/schema";
import { QUESTION_STATUS_LABELS } from "@/lib/packet/constants";
import { computePacketReadiness, PACKET_READINESS_COPY } from "@/lib/packet/readiness";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const TONE_VARIANTS: Record<string, NonNullable<BadgeProps["variant"]>> = {
  caution: "neutral",
  ok: "neutral",
  warn: "warning",
  ready: "success",
};

function QuestionCard({
  question,
  onUpdate,
  onDelete,
  onGenerate,
}: {
  question: ApplicationQuestion;
  onUpdate: (id: string, patch: { answer?: string; status?: string }) => Promise<void>;
  onDelete: (id: string) => void;
  onGenerate: (id: string) => Promise<ApplicationQuestion | null>;
}) {
  const [answer, setAnswer] = useState(question.answer ?? "");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const dirty = answer !== (question.answer ?? "");

  async function saveAnswer() {
    setSaving(true);
    try {
      await onUpdate(question.id, {
        answer,
        status: question.status === "needs_draft" ? "drafted" : question.status,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const updated = await onGenerate(question.id);
      if (updated) setAnswer(updated.answer ?? "");
    } finally {
      setGenerating(false);
    }
  }

  async function copyAnswer() {
    await navigator.clipboard.writeText(answer);
    toast.success("Answer copied");
  }

  return (
    <Card data-testid={`question-${question.id}`}>
      <CardContent className="space-y-2 py-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">{question.prompt}</p>
          <Badge variant="neutral" className="shrink-0">
            {QUESTION_STATUS_LABELS[question.status as keyof typeof QUESTION_STATUS_LABELS] ?? question.status}
          </Badge>
        </div>
        <Textarea
          className="min-h-20"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          data-testid={`answer-${question.id}`}
        />
        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
            data-testid={`generate-answer-${question.id}`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {generating ? "Generating..." : "Generate answer from story bank"}
          </button>
          {dirty && (
            <button
              onClick={saveAnswer}
              disabled={saving}
              className="text-muted-foreground hover:text-foreground hover:underline"
              data-testid={`save-answer-${question.id}`}
            >
              {saving ? "Saving..." : "Save answer"}
            </button>
          )}
          {question.status !== "approved" && answer.trim() && (
            <button
              onClick={() => onUpdate(question.id, { status: "approved" })}
              className="inline-flex items-center gap-1 text-success hover:underline"
              data-testid={`approve-question-${question.id}`}
            >
              <Check className="h-3.5 w-3.5" /> Approve
            </button>
          )}
          <button
            onClick={copyAnswer}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
          >
            <Copy className="h-3.5 w-3.5" /> Copy answer
          </button>
          <button
            onClick={() => onDelete(question.id)}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive hover:underline"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PacketClient({
  job,
  initialQuestions,
}: {
  job: Job;
  initialQuestions: ApplicationQuestion[];
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState(initialQuestions);
  const [scanning, setScanning] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [scannedAt, setScannedAt] = useState(job.applicationPromptsScannedAt);

  const readiness = computePacketReadiness({ applicationPromptsScannedAt: scannedAt }, questions);
  const copy = PACKET_READINESS_COPY[readiness];

  async function handleScrape() {
    setScanning(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/scrape-questions`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to scrape prompts");
      setQuestions(body.questions);
      setScannedAt(new Date());
      body.warnings.forEach((w: string) => toast.warning(w));
      toast.success(`Scraped: found ${body.found}, added ${body.added}, skipped ${body.skipped}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to scrape prompts");
    } finally {
      setScanning(false);
    }
  }

  async function handleAddPrompt() {
    if (!newPrompt.trim()) return;
    try {
      const res = await fetch(`/api/jobs/${job.id}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: newPrompt }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to add prompt");
      setQuestions((qs) => [...qs, body.question]);
      setNewPrompt("");
      setShowAdd(false);
      toast.success("Prompt added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add prompt");
    }
  }

  async function handleUpdate(id: string, patch: { answer?: string; status?: string }) {
    try {
      const res = await fetch(`/api/questions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update");
      setQuestions((qs) => qs.map((q) => (q.id === id ? body.question : q)));
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  }

  async function handleGenerate(id: string): Promise<ApplicationQuestion | null> {
    try {
      const res = await fetch(`/api/questions/${id}/generate-answer`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to generate answer");
      setQuestions((qs) => qs.map((q) => (q.id === id ? body.question : q)));
      toast.success("Answer drafted from story bank");
      return body.question;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate answer");
      return null;
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this prompt?")) return;
    try {
      const res = await fetch(`/api/questions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setQuestions((qs) => qs.filter((q) => q.id !== id));
      toast.success("Prompt deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function copyAll() {
    const text = questions
      .map((q) => `Q: ${q.prompt}\nA: ${q.answer ?? "(no answer yet)"}`)
      .join("\n\n");
    await navigator.clipboard.writeText(text);
    toast.success("All answers copied");
  }

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title={`${job.company} — ${job.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={TONE_VARIANTS[copy.tone] ?? "neutral"} data-testid="packet-readiness">
              {copy.label}
            </Badge>
            {job.tailoredResumeSlug ? (
              <a
                href={`/api/resumes/${job.tailoredResumeSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm hover:underline"
              >
                Tailored resume ready
              </a>
            ) : (
              <a href={`/tailor/${job.id}`} className="text-sm hover:underline">
                No resume yet — tailor it
              </a>
            )}
            {job.applyUrl && (
              <a
                href={job.applyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm hover:underline"
              >
                Open apply link
              </a>
            )}
          </span>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Button
          onClick={handleScrape}
          disabled={scanning || !job.applyUrl}
          data-testid="scrape-prompts-button"
          title={!job.applyUrl ? "Add an apply URL first" : undefined}
        >
          <ScanLine className="h-4 w-4" />
          {scanning ? "Scraping..." : "Scrape prompts"}
        </Button>
        <Button variant="outline" onClick={() => setShowAdd(true)} data-testid="add-prompt-button">
          <Plus className="h-4 w-4" />
          Add prompt manually
        </Button>
        {questions.length > 0 && (
          <Button variant="outline" onClick={copyAll}>
            <Copy className="h-4 w-4" />
            Copy all answers
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Scraping may miss hidden, multi-step, auth-gated, or anti-bot forms — always double-check against the real application.
      </p>

      <div className="space-y-3">
        {questions.map((q) => (
          <QuestionCard key={q.id} question={q} onUpdate={handleUpdate} onDelete={handleDelete} onGenerate={handleGenerate} />
        ))}
      </div>

      {showAdd && (
        <Modal title="Add prompt" onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <Textarea
              className="min-h-24"
              placeholder="Paste the application question..."
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              data-testid="new-prompt-input"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddPrompt} data-testid="submit-new-prompt">
                Add
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
