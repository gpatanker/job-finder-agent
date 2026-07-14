import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { PipelineClient } from "./pipeline-client";

export default async function PipelinePage() {
  const allJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.isSample, false))
    .orderBy(desc(jobs.updatedAt));

  return <PipelineClient initialJobs={allJobs} />;
}
