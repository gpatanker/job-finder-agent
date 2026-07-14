import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { applicationQuestions, jobs } from "@/lib/db/schema";
import { computePacketReadiness, PACKET_READINESS_COPY } from "@/lib/packet/readiness";

const TONE_CLASSES: Record<string, string> = {
  caution: "bg-black/5 dark:bg-white/10",
  ok: "bg-black/5 dark:bg-white/10",
  warn: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  ready: "bg-green-500/15 text-green-700 dark:text-green-400",
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
      <h1 className="text-lg font-semibold">Application Packet</h1>

      {allJobs.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60" data-testid="packet-empty">
          No jobs yet. Add one in Pipeline first.
        </p>
      ) : (
        <div className="divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/15">
          {allJobs.map((job) => {
            const readiness = computePacketReadiness(job, questionsByJob.get(job.id) ?? []);
            const copy = PACKET_READINESS_COPY[readiness];
            return (
              <Link
                key={job.id}
                href={`/packet/${job.id}`}
                className="flex items-center justify-between px-4 py-3 text-sm hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                data-testid={`packet-link-${job.id}`}
              >
                <div>
                  <p className="font-medium">{job.company}</p>
                  <p className="text-black/60 dark:text-white/60">{job.title}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs ${TONE_CLASSES[copy.tone]}`}>
                  {copy.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
