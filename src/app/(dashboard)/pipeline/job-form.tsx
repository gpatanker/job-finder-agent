"use client";

import { useState, type FormEvent } from "react";
import { WORK_MODES } from "@/lib/pipeline/constants";

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

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
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
          <input
            className={inputClass}
            required
            value={values.company}
            onChange={(e) => set("company", e.target.value)}
            data-testid="job-form-company"
          />
        </Field>
        <Field label="Title *">
          <input
            className={inputClass}
            required
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
            data-testid="job-form-title"
          />
        </Field>
        <Field label="Team">
          <input
            className={inputClass}
            value={values.team}
            onChange={(e) => set("team", e.target.value)}
          />
        </Field>
        <Field label="Location">
          <input
            className={inputClass}
            value={values.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </Field>
        <Field label="Work mode">
          <select
            className={inputClass}
            value={values.workMode}
            onChange={(e) => set("workMode", e.target.value)}
          >
            <option value="">—</option>
            {WORK_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source / platform">
          <input
            className={inputClass}
            placeholder="Greenhouse, Ashby, LinkedIn..."
            value={values.sourcePlatform}
            onChange={(e) => set("sourcePlatform", e.target.value)}
          />
        </Field>
        <Field label="Match score (0-100)">
          <input
            type="number"
            min={0}
            max={100}
            className={inputClass}
            value={values.matchScore}
            onChange={(e) => set("matchScore", e.target.value)}
          />
        </Field>
        <Field label="Role family">
          <input
            className={inputClass}
            value={values.roleFamily}
            onChange={(e) => set("roleFamily", e.target.value)}
          />
        </Field>
        <Field label="Salary min">
          <input
            type="number"
            className={inputClass}
            value={values.salaryMin}
            onChange={(e) => set("salaryMin", e.target.value)}
          />
        </Field>
        <Field label="Salary max">
          <input
            type="number"
            className={inputClass}
            value={values.salaryMax}
            onChange={(e) => set("salaryMax", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Salary text (fallback if no min/max)">
        <input
          className={inputClass}
          placeholder="$140k-$180k + equity"
          value={values.salaryText}
          onChange={(e) => set("salaryText", e.target.value)}
        />
      </Field>

      <Field label="Apply URL">
        <input
          type="url"
          className={inputClass}
          placeholder="https://..."
          value={values.applyUrl}
          onChange={(e) => set("applyUrl", e.target.value)}
          data-testid="job-form-apply-url"
        />
      </Field>

      <Field label="Resume angle">
        <input
          className={inputClass}
          placeholder="Emphasize GPU infra + vendor negotiation"
          value={values.resumeAngle}
          onChange={(e) => set("resumeAngle", e.target.value)}
        />
      </Field>

      <Field label="Job description">
        <textarea
          className={`${inputClass} min-h-24`}
          value={values.jobDescription}
          onChange={(e) => set("jobDescription", e.target.value)}
        />
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          data-testid="job-form-submit"
        >
          {pending ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
