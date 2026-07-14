import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentRunQueue } from "@/lib/db/schema";
import { RunQueueClient } from "./run-queue-client";

export default async function RunQueuePage() {
  const runs = await db.select().from(agentRunQueue).orderBy(desc(agentRunQueue.createdAt));

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Run Queue</h1>
      <RunQueueClient initialRuns={runs} />
    </main>
  );
}
