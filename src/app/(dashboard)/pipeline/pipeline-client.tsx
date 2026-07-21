"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  MoreHorizontal,
  Plus,
  ExternalLink,
  FileText,
  ClipboardList,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import type { Job } from "@/lib/db/schema";
import {
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  type JobStatus,
} from "@/lib/pipeline/constants";
import { jobStatusBadgeVariant, approvalStatusBadgeVariant } from "@/lib/pipeline/badge";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  return <Badge variant={jobStatusBadgeVariant(status)}>{label}</Badge>;
}

function ApprovalBadge({
  approvalStatus,
  jobId,
}: {
  approvalStatus: string;
  jobId: string;
}) {
  return (
    <Badge
      variant={approvalStatusBadgeVariant(approvalStatus)}
      data-testid={`approval-badge-${jobId}`}
    >
      {approvalStatus}
    </Badge>
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
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
      <PageHeader
        title="Pipeline"
        description="Every role you're tracking, from first sighting to applied or blocked."
        action={
          <Button onClick={() => setShowAddDialog(true)} data-testid="add-job-button">
            <Plus className="h-4 w-4" />
            Add job
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search company or title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
          data-testid="pipeline-search"
        />
        <Select value={statusFilter || "__all"} onValueChange={(v) => setStatusFilter(v === "__all" ? "" : v)}>
          <SelectTrigger className="w-48" data-testid="pipeline-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All statuses</SelectItem>
            {JOB_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {JOB_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {initialJobs.length === 0 ? (
        <Card>
          <CardContent
            className="py-12 text-center text-sm text-muted-foreground"
            data-testid="pipeline-empty"
          >
            No jobs yet. Click &ldquo;Add job&rdquo; to track your first role.
          </CardContent>
        </Card>
      ) : filteredJobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No jobs match your filters.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="pipeline-table">
              <thead className="border-b border-border bg-secondary/40">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Company / Title</th>
                  <th className="px-3 py-2.5 font-medium">Location</th>
                  <th className="px-3 py-2.5 font-medium">Match</th>
                  <th className="px-3 py-2.5 font-medium">Salary</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Approval</th>
                  <th className="px-3 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-border last:border-0 hover:bg-secondary/20"
                    data-testid={`job-row-${job.id}`}
                  >
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{job.company}</p>
                      <p className="text-muted-foreground">{job.title}</p>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {job.location ?? "—"}
                      {job.workMode ? ` (${job.workMode})` : ""}
                    </td>
                    <td className="px-3 py-2.5">
                      {job.matchScore != null ? `${job.matchScore}/100` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {job.salaryText ??
                        (job.salaryMin && job.salaryMax
                          ? `$${job.salaryMin / 1000}k–$${job.salaryMax / 1000}k`
                          : "—")}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-3 py-2.5">
                      <ApprovalBadge
                        approvalStatus={job.approvalStatus}
                        jobId={job.id}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {job.approvalStatus !== "approved" && (
                            <DropdownMenuItem
                              onSelect={() =>
                                patchJob(
                                  job,
                                  { status: "approved", approvalStatus: "approved" },
                                  `Approved ${job.company}`
                                )
                              }
                              data-testid={`approve-${job.id}`}
                            >
                              <Check className="h-4 w-4" /> Approve
                            </DropdownMenuItem>
                          )}
                          {job.approvalStatus !== "rejected" && (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                patchJob(
                                  job,
                                  { status: "rejected", approvalStatus: "rejected" },
                                  `Rejected ${job.company}`
                                )
                              }
                              data-testid={`reject-${job.id}`}
                            >
                              <X className="h-4 w-4" /> Reject
                            </DropdownMenuItem>
                          )}
                          {job.status !== "applied" && (
                            <DropdownMenuItem
                              onSelect={() =>
                                patchJob(
                                  job,
                                  { status: "applied" },
                                  `Marked ${job.company} as applied`
                                )
                              }
                            >
                              <Check className="h-4 w-4" /> Mark applied
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild data-testid={`tailor-${job.id}`}>
                            <a href={`/tailor/${job.id}`}>
                              <FileText className="h-4 w-4" />
                              {job.tailoredResumeSlug ? "Resume ✓" : "Tailor resume"}
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild data-testid={`packet-${job.id}`}>
                            <a href={`/packet/${job.id}`}>
                              <ClipboardList className="h-4 w-4" /> Packet
                            </a>
                          </DropdownMenuItem>
                          {job.applyUrl && (
                            <DropdownMenuItem asChild>
                              <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4" /> Apply link
                              </a>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => setEditingJob(job)}
                            data-testid={`edit-${job.id}`}
                          >
                            <Pencil className="h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => handleDelete(job)}
                            data-testid={`delete-${job.id}`}
                          >
                            <Trash2 className="h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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
