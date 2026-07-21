import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ClipboardList } from "lucide-react";
import { db } from "@/lib/db/client";
import { applicationQuestions, jobs } from "@/lib/db/schema";
import { computePacketReadiness, PACKET_READINESS_COPY } from "@/lib/packet/readiness";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const TONE_VARIANTS: Record<string, NonNullable<BadgeProps["variant"]>> = {
  caution: "neutral",
  ok: "neutral",
  warn: "warning",
  ready: "success",
};

export default async function PacketIndexPage() {
  const allJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.isSample, false))
    .orderBy(desc(jobs.updatedAt));

  const allQuestions = await db.select().from(applicationQuestions);
  const questionsByJob = new Map<string, typeof allQuestions>();
  for (const q of allQuestions) {
    const list = questionsByJob.get(q.jobId) ?? [];
    list.push(q);
    questionsByJob.set(q.jobId, list);
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <PageHeader
        title="Application Packet"
        description="Track scraped application questions and drafted answers per job."
      />

      {allJobs.length === 0 ? (
        <Card>
          <CardContent
            className="py-12 text-center text-sm text-muted-foreground"
            data-testid="packet-empty"
          >
            No jobs yet. Add one in Pipeline first.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y divide-border">
            {allJobs.map((job) => {
              const readiness = computePacketReadiness(job, questionsByJob.get(job.id) ?? []);
              const copy = PACKET_READINESS_COPY[readiness];
              return (
                <Link
                  key={job.id}
                  href={`/packet/${job.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-secondary/40"
                  data-testid={`packet-link-${job.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                      <ClipboardList className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">{job.company}</p>
                      <p className="text-muted-foreground">{job.title}</p>
                    </div>
                  </div>
                  <Badge variant={TONE_VARIANTS[copy.tone] ?? "neutral"}>{copy.label}</Badge>
                </Link>
              );
            })}
          </div>
        </Card>
      )}
    </main>
  );
}
