"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ApplicationQuestion, Job } from "@/lib/db/schema";
import { QUESTION_STATUS_LABELS } from "@/lib/packet/constants";
import { computePacketReadiness, PACKET_READINESS_COPY } from "@/lib/packet/readiness";
import { Modal } from "@/components/ui/modal";

const TONE_CLASSES: Record<string, string> = {
  caution: "bg-black/5 dark:bg-white/10",
  ok: "bg-black/5 dark:bg-white/10",
  warn: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  ready: "bg-green-500/15 text-green-700 dark:text-green-400",
};

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50";

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
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/15" data-testid={`question-${question.id}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{question.prompt}</p>
        <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
          {QUESTION_STATUS_LABELS[question.status as keyof typeof QUESTION_STATUS_LABELS] ?? question.status}
        </span>
      </div>
      <textarea
        className={`${inputClass} mt-2 min-h-20`}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        data-testid={`answer-${question.id}`}
      />
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <button onClick={handleGenerate} disabled={generating} className="hover:underline" data-testid={`generate-answer-${question.id}`}>
          {generating ? "Generating..." : "Generate answer from story bank"}
        </button>
        {dirty && (
          <button onClick={saveAnswer} disabled={saving} className="hover:underline" data-testid={`save-answer-${question.id}`}>
            {saving ? "Saving..." : "Save answer"}
          </button>
        )}
        {question.status !== "approved" && answer.trim() && (
          <button
            onClick={() => onUpdate(question.id, { status: "approved" })}
            className="text-green-700 hover:underline dark:text-green-400"
            data-testid={`approve-question-${question.id}`}
          >
            Approve
          </button>
        )}
        <button onClick={copyAnswer} className="hover:underline">
          Copy answer
        </button>
        <button onClick={() => onDelete(question.id)} className="text-black/50 hover:underline dark:text-white/50">
          Delete
        </button>
      </div>
    </div>
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
      <div>
        <h1 className="text-lg font-semibold">
          {job.company} — {job.title}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-full px-2 py-0.5 text-xs ${TONE_CLASSES[copy.tone]}`} data-testid="packet-readiness">
            {copy.label}
          </span>
          {job.tailoredResumeSlug ? (
            <a href={`/api/resumes/${job.tailoredResumeSlug}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
              Tailored resume ready
            </a>
          ) : (
            <a href={`/tailor/${job.id}`} className="hover:underline">
              No resume yet — tailor it
            </a>
          )}
          {job.applyUrl && (
            <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
              Open apply link
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleScrape}
          disabled={scanning || !job.applyUrl}
          className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          data-testid="scrape-prompts-button"
          title={!job.applyUrl ? "Add an apply URL first" : undefined}
        >
          {scanning ? "Scraping..." : "Scrape prompts"}
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          data-testid="add-prompt-button"
        >
          Add prompt manually
        </button>
        {questions.length > 0 && (
          <button onClick={copyAll} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20">
            Copy all answers
          </button>
        )}
      </div>

      <p className="text-xs text-black/50 dark:text-white/50">
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
            <textarea
              className={`${inputClass} min-h-24`}
              placeholder="Paste the application question..."
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              data-testid="new-prompt-input"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20">
                Cancel
              </button>
              <button
                onClick={handleAddPrompt}
                className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
                data-testid="submit-new-prompt"
              >
                Add
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
