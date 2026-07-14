import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentRunQueue, jobs } from "@/lib/db/schema";

export async function GET() {
  const [run] = await db
    .select()
    .from(agentRunQueue)
    .where(eq(agentRunQueue.status, "queued"))
    .orderBy(asc(agentRunQueue.createdAt))
    .limit(1);

  if (!run) {
    return NextResponse.json({ run: null });
  }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, run.jobId));

  return NextResponse.json({ run, job: job ?? null });
}
