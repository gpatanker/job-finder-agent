import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs, resumeProfile } from "@/lib/db/schema";
import { TailorClient } from "./tailor-client";

export default async function TailorJobPage(
  props: PageProps<"/tailor/[jobId]">
) {
  const { jobId } = await props.params;

  const [[job], [resume]] = await Promise.all([
    db.select().from(jobs).where(eq(jobs.id, jobId)),
    db.select().from(resumeProfile).limit(1),
  ]);

  if (!job) notFound();

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <TailorClient job={job} resume={resume?.data ?? null} />
    </main>
  );
}
