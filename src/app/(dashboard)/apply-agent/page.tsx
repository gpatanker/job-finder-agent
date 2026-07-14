import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { applicationQuestions, jobs } from "@/lib/db/schema";
import { ApplyAgentClient } from "./apply-agent-client";

export default async function ApplyAgentPage() {
  const allJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.isSample, false))
    .orderBy(desc(jobs.updatedAt));

  const allQuestions = await db.select().from(applicationQuestions);
  const questionsByJob: Record<string, typeof allQuestions> = {};
  for (const q of allQuestions) {
    (questionsByJob[q.jobId] ??= []).push(q);
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Apply Agent</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        This dashboard never submits an application itself. It prepares a brief and queues the task for Computer —
        the actual form-filling happens in a separate browser-automation step you authorize.
      </p>
      <ApplyAgentClient jobs={allJobs} questionsByJob={questionsByJob} />
    </main>
  );
}
