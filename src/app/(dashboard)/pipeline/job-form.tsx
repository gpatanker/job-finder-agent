"use client";

import { useState, type FormEvent } from "react";
import { WORK_MODES } from "@/lib/pipeline/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type JobFormValues = {
  company: string;
  title: string;
  team: string;
  location: string;
  workMode: string;
  sourcePlatform: string;
  applyUrl: string;
  jobDescription: string;
  salaryMin: string;
  salaryMax: string;
  salaryText: string;
  matchScore: string;
  roleFamily: string;
  resumeAngle: string;
};

export const EMPTY_JOB_FORM_VALUES: JobFormValues = {
  company: "",
  title: "",
  team: "",
  location: "",
  workMode: "",
  sourcePlatform: "",
  applyUrl: "",
  jobDescription: "",
  salaryMin: "",
  salaryMax: "",
  salaryText: "",
  matchScore: "",
  roleFamily: "",
  resumeAngle: "",
};

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function JobForm({
  initialValues,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initialValues: JobFormValues;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: JobFormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initialValues);

  function set<K extends keyof JobFormValues>(key: K, value: JobFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="job-form">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company *">
          <Input
            required
            value={values.company}
            onChange={(e) => set("company", e.target.value)}
            data-testid="job-form-company"
          />
        </Field>
        <Field label="Title *">
          <Input
            required
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
            data-testid="job-form-title"
          />
        </Field>
        <Field label="Team">
          <Input value={values.team} onChange={(e) => set("team", e.target.value)} />
        </Field>
        <Field label="Location">
          <Input
            value={values.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </Field>
        <Field label="Work mode">
          <Select
            value={values.workMode || undefined}
            onValueChange={(v) => set("workMode", v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {WORK_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Source / platform">
          <Input
            placeholder="Greenhouse, Ashby, LinkedIn..."
            value={values.sourcePlatform}
            onChange={(e) => set("sourcePlatform", e.target.value)}
          />
        </Field>
        <Field label="Match score (0-100)">
          <Input
            type="number"
            min={0}
            max={100}
            value={values.matchScore}
            onChange={(e) => set("matchScore", e.target.value)}
          />
        </Field>
        <Field label="Role family">
          <Input
            value={values.roleFamily}
            onChange={(e) => set("roleFamily", e.target.value)}
          />
        </Field>
        <Field label="Salary min">
          <Input
            type="number"
            value={values.salaryMin}
            onChange={(e) => set("salaryMin", e.target.value)}
          />
        </Field>
        <Field label="Salary max">
          <Input
            type="number"
            value={values.salaryMax}
            onChange={(e) => set("salaryMax", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Salary text (fallback if no min/max)">
        <Input
          placeholder="$140k-$180k + equity"
          value={values.salaryText}
          onChange={(e) => set("salaryText", e.target.value)}
        />
      </Field>

      <Field label="Apply URL">
        <Input
          type="url"
          placeholder="https://..."
          value={values.applyUrl}
          onChange={(e) => set("applyUrl", e.target.value)}
          data-testid="job-form-apply-url"
        />
      </Field>

      <Field label="Resume angle">
        <Input
          placeholder="Emphasize GPU infra + vendor negotiation"
          value={values.resumeAngle}
          onChange={(e) => set("resumeAngle", e.target.value)}
        />
      </Field>

      <Field label="Job description">
        <Textarea
          className="min-h-24"
          value={values.jobDescription}
          onChange={(e) => set("jobDescription", e.target.value)}
        />
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} data-testid="job-form-submit">
          {pending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
