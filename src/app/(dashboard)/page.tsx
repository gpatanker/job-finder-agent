import Link from "next/link";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  jobs,
  jobSearchSuggestions,
  agentRunQueue,
  llmUsageLog,
  applicationQuestions,
  questionBankEntries,
} from "@/lib/db/schema";
import { BLOCK_REASON_LABELS, type BlockReason } from "@/lib/pipeline/constants";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { FunnelChart, TrendChart } from "./overview-charts";
import {
  Briefcase,
  Inbox,
  ClipboardCheck,
  CheckCircle2,
  Send,
  XCircle,
  Target,
  DollarSign,
  ArrowRight,
  FileText,
  ClipboardList,
  ExternalLink,
  Clock,
  Hourglass,
  AlertTriangle,
  Recycle,
} from "lucide-react";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const FUNNEL_BUCKETS: { stage: string; statuses: string[] }[] = [
  { stage: "Discovered", statuses: ["discovered"] },
  { stage: "Reviewing", statuses: ["needs_review", "approval_due"] },
  { stage: "Approved", statuses: ["approved", "packet_needed", "ready_to_apply"] },
  { stage: "Queued", statuses: ["queued", "in_progress"] },
  { stage: "Applied", statuses: ["applied"] },
  { stage: "Closed", statuses: ["blocked", "rejected", "archived"] },
];

function formatSalary(job: {
  salaryText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
}) {
  if (job.salaryText) return job.salaryText;
  if (job.salaryMin && job.salaryMax) {
    return `$${Math.round(job.salaryMin / 1000)}k–$${Math.round(job.salaryMax / 1000)}k`;
  }
  return null;
}

export default async function OverviewPage() {
  const [allJobs, newSuggestionsCount, usageRows, runRows, questionBankRows, answeredQuestions] =
    await Promise.all([
      db
        .select({
          id: jobs.id,
          company: jobs.company,
          title: jobs.title,
          location: jobs.location,
          workMode: jobs.workMode,
          status: jobs.status,
          approvalStatus: jobs.approvalStatus,
          matchScore: jobs.matchScore,
          salaryMin: jobs.salaryMin,
          salaryMax: jobs.salaryMax,
          salaryText: jobs.salaryText,
          applyUrl: jobs.applyUrl,
          tailoredResumeSlug: jobs.tailoredResumeSlug,
          createdAt: jobs.createdAt,
          appliedAt: jobs.appliedAt,
          blockReason: jobs.blockReason,
          tailoredResumeGeneratedAt: jobs.tailoredResumeGeneratedAt,
          applicationPromptsScannedAt: jobs.applicationPromptsScannedAt,
        })
        .from(jobs)
        .where(eq(jobs.isSample, false)),
      db
        .select({ id: jobSearchSuggestions.id })
        .from(jobSearchSuggestions)
        .where(eq(jobSearchSuggestions.status, "new")),
      db.select({ estimatedCostUsd: llmUsageLog.estimatedCostUsd }).from(llmUsageLog),
      db
        .select({
          runType: agentRunQueue.runType,
          status: agentRunQueue.status,
          startedAt: agentRunQueue.startedAt,
          completedAt: agentRunQueue.completedAt,
          requiredManualInput: agentRunQueue.requiredManualInput,
        })
        .from(agentRunQueue),
      db.select({ hitCount: questionBankEntries.hitCount }).from(questionBankEntries),
      db
        .select({ id: applicationQuestions.id })
        .from(applicationQuestions)
        .where(isNotNull(applicationQuestions.answer)),
    ]);

  const total = allJobs.length;

  if (total === 0) {
    return (
      <main className="flex flex-1 flex-col gap-6 p-6">
        <PageHeader
          title="Dashboard"
          description="Funnel health, approval queue, and top postings will show up here once you start tracking roles."
        />
        <Card>
          <CardContent
            className="flex flex-col items-center gap-3 py-16 text-center"
            data-testid="overview-empty"
          >
            <div className="rounded-full bg-secondary p-3">
              <Briefcase className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              No jobs yet. Head to Pipeline to add your first one.
            </p>
            <Button asChild size="sm">
              <Link href="/pipeline">
                Open pipeline <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const pendingReview = allJobs.filter((j) => j.approvalStatus === "pending").length;
  const approved = allJobs.filter((j) => j.approvalStatus === "approved").length;
  const applied = allJobs.filter((j) => j.status === "applied").length;
  const closed = allJobs.filter((j) => ["blocked", "rejected"].includes(j.status)).length;
  const scored = allJobs.filter((j) => j.matchScore != null);
  const avgScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, j) => sum + (j.matchScore ?? 0), 0) / scored.length)
      : null;
  const salaryDisclosed = allJobs.filter((j) => formatSalary(j) != null).length;
  const salaryPct = total > 0 ? Math.round((salaryDisclosed / total) * 100) : 0;

  // --- Efficiency/cost KPIs ---
  const MANUAL_MINUTES_PER_APPLICATION = 20;

  const totalCostUsd = usageRows.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
  const costPerAppliedJob = applied > 0 && usageRows.length > 0 ? totalCostUsd / applied : null;

  const applicationRuns = runRows.filter((r) => r.runType === "application");
  const runsWithTiming = applicationRuns.filter((r) => r.startedAt && r.completedAt);
  const runDurationMinutes = (r: (typeof runsWithTiming)[number]) =>
    (new Date(r.completedAt!).getTime() - new Date(r.startedAt!).getTime()) / 60_000;
  const avgSubmitMinutes =
    runsWithTiming.length > 0
      ? runsWithTiming.reduce((sum, r) => sum + runDurationMinutes(r), 0) / runsWithTiming.length
      : null;

  const appliedRunsWithTiming = runsWithTiming.filter((r) => r.status === "completed");
  const automatedMinutesForApplied = appliedRunsWithTiming.reduce(
    (sum, r) => sum + runDurationMinutes(r),
    0
  );
  const manualTimeSavedHours =
    applied > 0
      ? Math.max(0, (applied * MANUAL_MINUTES_PER_APPLICATION - automatedMinutesForApplied) / 60)
      : null;

  const terminalRuns = applicationRuns.filter((r) =>
    ["completed", "blocked", "cancelled"].includes(r.status)
  );
  const manualInterventionPct =
    terminalRuns.length > 0
      ? Math.round(
          (100 * terminalRuns.filter((r) => r.requiredManualInput).length) / terminalRuns.length
        )
      : null;

  const totalQuestionBankHits = questionBankRows.reduce((sum, r) => sum + r.hitCount, 0);
  const reuseRatePct =
    answeredQuestions.length > 0
      ? Math.round((100 * totalQuestionBankHits) / answeredQuestions.length)
      : null;

  const blockedJobs = allJobs.filter((j) => j.status === "blocked");
  const blockReasonData = Object.entries(
    blockedJobs.reduce<Record<string, number>>((acc, j) => {
      const reason = (j.blockReason as BlockReason | null) ?? "other";
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([reason, count]) => ({
    stage: BLOCK_REASON_LABELS[reason as BlockReason] ?? reason,
    count,
  }));

  const daysBetween = (a: Date | string, b: Date | string) =>
    (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
  const discoveredToTailored = median(
    allJobs
      .filter((j) => j.tailoredResumeGeneratedAt)
      .map((j) => daysBetween(j.createdAt, j.tailoredResumeGeneratedAt!))
  );
  const tailoredToScanned = median(
    allJobs
      .filter((j) => j.tailoredResumeGeneratedAt && j.applicationPromptsScannedAt)
      .map((j) => daysBetween(j.tailoredResumeGeneratedAt!, j.applicationPromptsScannedAt!))
  );
  const scannedToApplied = median(
    allJobs
      .filter((j) => j.applicationPromptsScannedAt && j.appliedAt)
      .map((j) => daysBetween(j.applicationPromptsScannedAt!, j.appliedAt!))
  );

  const stats = [
    { label: "Total postings", value: total, icon: Briefcase, testid: "stat-total-postings" },
    {
      label: "New suggestions",
      value: newSuggestionsCount.length,
      icon: Inbox,
      testid: "stat-new-suggestions",
    },
    {
      label: "Pending review",
      value: pendingReview,
      icon: ClipboardCheck,
      accent: pendingReview > 0 ? ("warning" as const) : undefined,
      testid: "stat-pending-review",
    },
    { label: "Approved", value: approved, icon: CheckCircle2, testid: "stat-approved" },
    {
      label: "Applied",
      value: applied,
      icon: Send,
      accent: "success" as const,
      testid: "stat-applied",
    },
    {
      label: "Blocked / Rejected",
      value: closed,
      icon: XCircle,
      accent: closed > 0 ? ("danger" as const) : undefined,
      testid: "stat-blocked-rejected",
    },
    {
      label: "Avg. fit score",
      value: avgScore != null ? `${avgScore}/100` : "—",
      icon: Target,
      testid: "stat-avg-fit-score",
    },
    {
      label: "Salary disclosed",
      value: `${salaryPct}%`,
      icon: DollarSign,
      testid: "stat-salary-disclosed",
    },
  ];

  const efficiencyStats = [
    {
      label: "Est. API cost",
      value: usageRows.length > 0 ? `$${totalCostUsd.toFixed(2)}` : "—",
      icon: DollarSign,
      testid: "stat-api-cost",
    },
    {
      label: "Cost per applied job",
      value: costPerAppliedJob != null ? `$${costPerAppliedJob.toFixed(2)}` : "—",
      icon: DollarSign,
      testid: "stat-cost-per-applied",
    },
    {
      label: "Avg. time to submit",
      value: avgSubmitMinutes != null ? `${Math.round(avgSubmitMinutes)} min` : "No data yet",
      icon: Clock,
      testid: "stat-avg-submit-time",
    },
    {
      label: "Manual time saved (est.)",
      value: manualTimeSavedHours != null ? `${manualTimeSavedHours.toFixed(1)} hrs` : "—",
      icon: Hourglass,
      accent: "success" as const,
      testid: "stat-manual-time-saved",
    },
    {
      label: "Manual intervention rate",
      value: manualInterventionPct != null ? `${manualInterventionPct}%` : "No data yet",
      icon: AlertTriangle,
      accent: manualInterventionPct != null && manualInterventionPct > 50 ? ("warning" as const) : undefined,
      testid: "stat-manual-intervention-rate",
    },
    {
      label: "Question-bank reuse rate",
      value: reuseRatePct != null ? `${reuseRatePct}%` : "—",
      icon: Recycle,
      testid: "stat-reuse-rate",
    },
  ];

  const funnelData = FUNNEL_BUCKETS.map(({ stage, statuses }) => ({
    stage,
    count: allJobs.filter((j) => statuses.includes(j.status)).length,
  }));

  const trendData: { date: string; count: number }[] = [];
  const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  for (let i = 13; i >= 0; i--) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const nextDay = new Date(day);
    nextDay.setDate(day.getDate() + 1);
    const count = allJobs.filter((j) => {
      const created = new Date(j.createdAt);
      return created >= day && created < nextDay;
    }).length;
    trendData.push({ date: dayFormatter.format(day), count });
  }

  const awaitingApproval = allJobs
    .filter((j) => j.approvalStatus === "pending")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const topFit = allJobs
    .filter(
      (j) => j.matchScore != null && !["applied", "blocked", "rejected", "archived"].includes(j.status)
    )
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
    .slice(0, 5);

  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
      <PageHeader
        title="Dashboard"
        description="Funnel health, approval queue, and top postings. Every application requires explicit approval before submission."
        action={
          <Button asChild size="sm">
            <Link href="/pipeline">
              Open pipeline <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <StatTile
            key={stat.label}
            label={stat.label}
            value={stat.value}
            icon={stat.icon}
            accent={stat.accent}
            data-testid={stat.testid}
          />
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Automation efficiency</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {efficiencyStats.map((stat) => (
            <StatTile
              key={stat.label}
              label={stat.label}
              value={stat.value}
              icon={stat.icon}
              accent={stat.accent}
              data-testid={stat.testid}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FunnelChart data={funnelData} />
        <TrendChart data={trendData} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {blockReasonData.length > 0 && (
          <FunnelChart data={blockReasonData} title="Block reasons" />
        )}
        <Card>
          <CardHeader>
            <CardTitle>Time in stage (median days)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {[
              { label: "Discovered → resume tailored", value: discoveredToTailored },
              { label: "Tailored → prompts scanned", value: tailoredToScanned },
              { label: "Scanned → applied", value: scannedToApplied },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium tabular-nums">
                  {row.value != null ? `${row.value.toFixed(1)}d` : "—"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Awaiting approval</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {awaitingApproval.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No postings in the approval queue.
              </p>
            ) : (
              awaitingApproval.map((job) => (
                <Link
                  key={job.id}
                  href="/pipeline"
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm transition-colors hover:bg-secondary/50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{job.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {job.company}
                      {job.location ? ` · ${job.location}` : ""}
                    </p>
                  </div>
                  <Badge variant="warning" className="shrink-0">
                    Pending
                  </Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top fit (open postings)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {topFit.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No scored postings yet — run Search / Import to find some.
              </p>
            ) : (
              topFit.map((job) => {
                const salary = formatSalary(job);
                return (
                  <div
                    key={job.id}
                    className="flex items-center gap-3 rounded-md border border-border p-3 text-sm"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-foreground">
                      {job.matchScore}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{job.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {job.company}
                        {job.location ? ` · ${job.location}` : ""}
                        {salary ? ` · ${salary}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button asChild variant="ghost" size="icon" title="Tailor resume">
                        <Link href={`/tailor/${job.id}`}>
                          <FileText className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="icon" title="Application packet">
                        <Link href={`/packet/${job.id}`}>
                          <ClipboardList className="h-4 w-4" />
                        </Link>
                      </Button>
                      {job.applyUrl && (
                        <Button asChild variant="ghost" size="icon" title="Apply link">
                          <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
