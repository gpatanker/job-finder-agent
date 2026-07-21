import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentRunQueue } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { RunQueueClient } from "./run-queue-client";

export default async function RunQueuePage() {
  const runs = await db.select().from(agentRunQueue).orderBy(desc(agentRunQueue.createdAt));

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <PageHeader
        title="Run Queue"
        description="Apply runs queued for Computer to execute, and their live status."
      />
      <RunQueueClient initialRuns={runs} />
    </main>
  );
}
