"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ResumeProfile } from "@/lib/db/schema";

export function ResumeSection({ resume }: { resume: ResumeProfile | null }) {
  const [showRaw, setShowRaw] = useState(false);
  const [raw, setRaw] = useState(
    resume ? JSON.stringify(resume.data, null, 2) : "{}"
  );
  const [saving, setSaving] = useState(false);

  async function handleSaveRaw() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      toast.error("Invalid JSON — fix syntax and try again");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/resume", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save resume data");
      }
      toast.success("Resume data saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!resume) {
    return (
      <p className="text-sm text-black/60 dark:text-white/60" data-testid="resume-empty">
        No base resume seeded yet. Run{" "}
        <code className="rounded bg-black/5 px-1 dark:bg-white/10">
          npm run db:seed-profile
        </code>{" "}
        after filling in <code className="rounded bg-black/5 px-1 dark:bg-white/10">local/resume.seed.json</code>.
      </p>
    );
  }

  const data = resume.data;

  return (
    <div className="space-y-4" data-testid="resume-section">
      <div>
        <p className="font-semibold">{data.name}</p>
        <p className="text-sm text-black/60 dark:text-white/60">{data.contactLine}</p>
      </div>

      <div>
        <p className="text-sm font-medium">Education</p>
        {data.education.map((e, i) => (
          <p key={i} className="text-sm text-black/70 dark:text-white/70">
            {e.school} — {e.degree}
          </p>
        ))}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Experience</p>
        {data.experience.map((exp, i) => (
          <div key={i} className="rounded-lg border border-black/10 p-3 dark:border-white/15">
            <p className="text-sm font-medium">
              {exp.company} — {exp.role}
              {exp.team ? ` — ${exp.team}` : ""}
            </p>
            <p className="text-xs text-black/50 dark:text-white/50">
              {exp.location} · {exp.dateRange}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {exp.bullets.map((b) => (
                <li key={b.id}>{b.text}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div>
        <p className="text-sm font-medium">Skills</p>
        {data.skills.map((s, i) => (
          <p key={i} className="text-sm text-black/70 dark:text-white/70">
            <span className="font-medium">{s.category}:</span> {s.items.join(", ")}
          </p>
        ))}
      </div>

      {data.certifications.length > 0 && (
        <div>
          <p className="text-sm font-medium">Certifications</p>
          <p className="text-sm text-black/70 dark:text-white/70">
            {data.certifications.join(", ")}
          </p>
        </div>
      )}

      <div className="border-t border-black/10 pt-3 dark:border-white/15">
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="text-xs hover:underline"
        >
          {showRaw ? "Hide" : "Show"} advanced: edit raw resume JSON
        </button>
        {showRaw && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-black/50 dark:text-white/50">
              Prefer editing <code>local/resume.seed.json</code> and re-running{" "}
              <code>npm run db:seed-profile</code> for bigger changes. This is
              a raw escape hatch for quick fixes.
            </p>
            <textarea
              className="h-64 w-full rounded-md border border-black/15 bg-transparent p-2 font-mono text-xs outline-none dark:border-white/20"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              data-testid="resume-raw-json"
            />
            <button
              type="button"
              onClick={handleSaveRaw}
              disabled={saving}
              className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {saving ? "Saving..." : "Save raw JSON"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
