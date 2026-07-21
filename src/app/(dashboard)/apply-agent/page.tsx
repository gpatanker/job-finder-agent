import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { applicationQuestions, jobs } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title="Apply Agent"
        description="This dashboard never submits an application itself. It prepares a brief and queues the task for Computer — the actual form-filling happens in a separate browser-automation step you authorize."
      />
      <ApplyAgentClient jobs={allJobs} questionsByJob={questionsByJob} />
    </main>
  );
}
