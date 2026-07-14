"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Job } from "@/lib/db/schema";
import {
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  type JobStatus,
} from "@/lib/pipeline/constants";
import { Modal } from "@/components/ui/modal";
import {
  JobForm,
  EMPTY_JOB_FORM_VALUES,
  type JobFormValues,
} from "./job-form";

function jobToFormValues(job: Job): JobFormValues {
  return {
    company: job.company,
    title: job.title,
    team: job.team ?? "",
    location: job.location ?? "",
    workMode: job.workMode ?? "",
    sourcePlatform: job.sourcePlatform ?? "",
    applyUrl: job.applyUrl ?? "",
    jobDescription: job.jobDescription ?? "",
    salaryMin: job.salaryMin?.toString() ?? "",
    salaryMax: job.salaryMax?.toString() ?? "",
    salaryText: job.salaryText ?? "",
    matchScore: job.matchScore?.toString() ?? "",
    roleFamily: job.roleFamily ?? "",
    resumeAngle: job.resumeAngle ?? "",
  };
}

function formValuesToPayload(values: JobFormValues) {
  return {
    company: values.company,
    title: values.title,
    team: values.team || undefined,
    location: values.location || undefined,
    workMode: values.workMode || undefined,
    sourcePlatform: values.sourcePlatform || undefined,
    applyUrl: values.applyUrl || undefined,
    jobDescription: values.jobDescription || undefined,
    salaryMin: values.salaryMin ? Number(values.salaryMin) : undefined,
    salaryMax: values.salaryMax ? Number(values.salaryMax) : undefined,
    salaryText: values.salaryText || undefined,
    matchScore: values.matchScore ? Number(values.matchScore) : undefined,
    roleFamily: values.roleFamily || undefined,
    resumeAngle: values.resumeAngle || undefined,
  };
}

function StatusBadge({ status }: { status: string }) {
  const label = JOB_STATUS_LABELS[status as JobStatus] ?? status;
  return (
    <span className="inline-flex rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
      {label}
    </span>
  );
}

function ApprovalBadge({
  approvalStatus,
  jobId,
}: {
  approvalStatus: string;
  jobId: string;
}) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    approved: "bg-green-500/15 text-green-700 dark:text-green-400",
    rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
        styles[approvalStatus] ?? "bg-black/5 dark:bg-white/10"
      }`}
      data-testid={`approval-badge-${jobId}`}
    >
      {approvalStatus}
    </span>
  );
}

async function apiCall(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function PipelineClient({ initialJobs }: { initialJobs: Job[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [pending, setPending] = useState(false);

  const filteredJobs = useMemo(() => {
    return initialJobs.filter((job) => {
      if (statusFilter && job.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !job.company.toLowerCase().includes(q) &&
          !job.title.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [initialJobs, search, statusFilter]);

  async function handleCreate(values: JobFormValues) {
    setPending(true);
    try {
      await apiCall("/api/jobs", {
        method: "POST",
        body: JSON.stringify(formValuesToPayload(values)),
      });
      toast.success(`Added ${values.company} — ${values.title}`);
      setShowAddDialog(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add job");
    } finally {
      setPending(false);
    }
  }

  async function handleEdit(values: JobFormValues) {
    if (!editingJob) return;
    setPending(true);
    try {
      await apiCall(`/api/jobs/${editingJob.id}`, {
        method: "PATCH",
        body: JSON.stringify(formValuesToPayload(values)),
      });
      toast.success("Job updated");
      setEditingJob(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update job");
    } finally {
      setPending(false);
    }
  }

  async function patchJob(job: Job, patch: Record<string, unknown>, successMessage: string) {
    try {
      await apiCall(`/api/jobs/${job.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast.success(successMessage);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  }

  async function handleDelete(job: Job) {
    if (!confirm(`Delete ${job.company} — ${job.title}? This can't be undone.`)) {
      return;
    }
    try {
      await apiCall(`/api/jobs/${job.id}`, { method: "DELETE" });
      toast.success("Job deleted");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete job");
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Pipeline</h1>
        <button
          type="button"
          onClick={() => setShowAddDialog(true)}
          className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          data-testid="add-job-button"
        >
          Add job
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Search company or title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20"
          data-testid="pipeline-search"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          data-testid="pipeline-status-filter"
        >
          <option value="">All statuses</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {JOB_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {initialJobs.length === 0 ? (
        <p
          className="rounded-lg border border-dashed border-black/15 p-8 text-center text-sm text-black/60 dark:border-white/20 dark:text-white/60"
          data-testid="pipeline-empty"
        >
          No jobs yet. Click &ldquo;Add job&rdquo; to track your first role.
        </p>
      ) : filteredJobs.length === 0 ? (
        <p className="p-8 text-center text-sm text-black/60 dark:text-white/60">
          No jobs match your filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
          <table className="w-full text-left text-sm" data-testid="pipeline-table">
            <thead className="border-b border-black/10 bg-black/[0.02] dark:border-white/15 dark:bg-white/[0.03]">
              <tr>
                <th className="px-3 py-2 font-medium">Company / Title</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">Match</th>
                <th className="px-3 py-2 font-medium">Salary</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Approval</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((job) => (
                <tr
                  key={job.id}
                  className="border-b border-black/5 last:border-0 dark:border-white/10"
                  data-testid={`job-row-${job.id}`}
                >
                  <td className="px-3 py-2">
                    <p className="font-medium">{job.company}</p>
                    <p className="text-black/60 dark:text-white/60">
                      {job.title}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    {job.location ?? "—"}
                    {job.workMode ? ` (${job.workMode})` : ""}
                  </td>
                  <td className="px-3 py-2">
                    {job.matchScore != null ? `${job.matchScore}/100` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {job.salaryText ??
                      (job.salaryMin && job.salaryMax
                        ? `$${job.salaryMin / 1000}k–$${job.salaryMax / 1000}k`
                        : "—")}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="px-3 py-2">
                    <ApprovalBadge
                      approvalStatus={job.approvalStatus}
                      jobId={job.id}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {job.approvalStatus !== "approved" && (
                        <button
                          onClick={() =>
                            patchJob(
                              job,
                              { status: "approved", approvalStatus: "approved" },
                              `Approved ${job.company}`
                            )
                          }
                          className="text-xs text-green-700 hover:underline dark:text-green-400"
                          data-testid={`approve-${job.id}`}
                        >
                          Approve
                        </button>
                      )}
                      {job.approvalStatus !== "rejected" && (
                        <button
                          onClick={() =>
                            patchJob(
                              job,
                              { status: "rejected", approvalStatus: "rejected" },
                              `Rejected ${job.company}`
                            )
                          }
                          className="text-xs text-red-700 hover:underline dark:text-red-400"
                          data-testid={`reject-${job.id}`}
                        >
                          Reject
                        </button>
                      )}
                      {job.status !== "applied" && (
                        <button
                          onClick={() =>
                            patchJob(
                              job,
                              { status: "applied" },
                              `Marked ${job.company} as applied`
                            )
                          }
                          className="text-xs hover:underline"
                        >
                          Mark applied
                        </button>
                      )}
                      {job.applyUrl ? (
                        <a
                          href={job.applyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs hover:underline"
                        >
                          Apply link
                        </a>
                      ) : null}
                      <a
                        href={`/tailor/${job.id}`}
                        className="text-xs hover:underline"
                        data-testid={`tailor-${job.id}`}
                      >
                        {job.tailoredResumeSlug ? "Resume ✓" : "Tailor resume"}
                      </a>
                      <a
                        href={`/packet/${job.id}`}
                        className="text-xs hover:underline"
                        data-testid={`packet-${job.id}`}
                      >
                        Packet
                      </a>
                      <button
                        onClick={() => setEditingJob(job)}
                        className="text-xs hover:underline"
                        data-testid={`edit-${job.id}`}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(job)}
                        className="text-xs text-black/50 hover:underline dark:text-white/50"
                        data-testid={`delete-${job.id}`}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddDialog && (
        <Modal title="Add job" onClose={() => setShowAddDialog(false)}>
          <JobForm
            initialValues={EMPTY_JOB_FORM_VALUES}
            submitLabel="Add job"
            pending={pending}
            onSubmit={handleCreate}
            onCancel={() => setShowAddDialog(false)}
          />
        </Modal>
      )}

      {editingJob && (
        <Modal
          title={`Edit ${editingJob.company}`}
          onClose={() => setEditingJob(null)}
        >
          <JobForm
            initialValues={jobToFormValues(editingJob)}
            submitLabel="Save changes"
            pending={pending}
            onSubmit={handleEdit}
            onCancel={() => setEditingJob(null)}
          />
        </Modal>
      )}
    </div>
  );
}
