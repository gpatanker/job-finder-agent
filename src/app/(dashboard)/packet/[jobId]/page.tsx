import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { applicationQuestions, jobs } from "@/lib/db/schema";
import { PacketClient } from "./packet-client";

export default async function PacketJobPage(
  props: PageProps<"/packet/[jobId]">
) {
  const { jobId } = await props.params;

  const [[job], questions] = await Promise.all([
    db.select().from(jobs).where(eq(jobs.id, jobId)),
    db
      .select()
      .from(applicationQuestions)
      .where(eq(applicationQuestions.jobId, jobId))
      .orderBy(asc(applicationQuestions.createdAt)),
  ]);

  if (!job) notFound();

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <PacketClient job={job} initialQuestions={questions} />
    </main>
  );
}
