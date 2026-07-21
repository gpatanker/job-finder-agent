"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ResumeProfile } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

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
      <Card className="mt-4">
        <CardContent className="py-8 text-sm text-muted-foreground" data-testid="resume-empty">
          No base resume seeded yet. Run{" "}
          <code className="rounded bg-secondary px-1 py-0.5">npm run db:seed-profile</code>{" "}
          after filling in <code className="rounded bg-secondary px-1 py-0.5">local/resume.seed.json</code>.
        </CardContent>
      </Card>
    );
  }

  const data = resume.data;

  return (
    <div className="mt-4 space-y-4" data-testid="resume-section">
      <div>
        <p className="font-semibold">{data.name}</p>
        <p className="text-sm text-muted-foreground">{data.contactLine}</p>
      </div>

      <div>
        <p className="text-sm font-medium">Education</p>
        {data.education.map((e, i) => (
          <p key={i} className="text-sm text-muted-foreground">
            {e.school} — {e.degree}
          </p>
        ))}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Experience</p>
        {data.experience.map((exp, i) => (
          <Card key={i}>
            <CardContent className="py-3">
              <p className="text-sm font-medium">
                {exp.company} — {exp.role}
                {exp.team ? ` — ${exp.team}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {exp.location} · {exp.dateRange}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {exp.bullets.map((b) => (
                  <li key={b.id}>{b.text}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <p className="text-sm font-medium">Skills</p>
        {data.skills.map((s, i) => (
          <p key={i} className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{s.category}:</span> {s.items.join(", ")}
          </p>
        ))}
      </div>

      {data.certifications.length > 0 && (
        <div>
          <p className="text-sm font-medium">Certifications</p>
          <p className="text-sm text-muted-foreground">{data.certifications.join(", ")}</p>
        </div>
      )}

      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {showRaw ? "Hide" : "Show"} advanced: edit raw resume JSON
        </button>
        {showRaw && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              Prefer editing <code>local/resume.seed.json</code> and re-running{" "}
              <code>npm run db:seed-profile</code> for bigger changes. This is
              a raw escape hatch for quick fixes.
            </p>
            <Textarea
              className="h-64 font-mono text-xs"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              data-testid="resume-raw-json"
            />
            <Button onClick={handleSaveRaw} disabled={saving}>
              {saving ? "Saving..." : "Save raw JSON"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
