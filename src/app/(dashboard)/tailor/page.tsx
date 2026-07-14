import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";

export default async function TailorIndexPage() {
  const allJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.isSample, false))
    .orderBy(desc(jobs.updatedAt));

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Resume Tailor</h1>

      {allJobs.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60" data-testid="tailor-empty">
          No jobs yet. Add one in Pipeline first.
        </p>
      ) : (
        <div className="divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/15">
          {allJobs.map((job) => (
            <Link
              key={job.id}
              href={`/tailor/${job.id}`}
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
              data-testid={`tailor-link-${job.id}`}
            >
              <div>
                <p className="font-medium">{job.company}</p>
                <p className="text-black/60 dark:text-white/60">{job.title}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  job.tailoredResumeSlug
                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                    : "bg-black/5 dark:bg-white/10"
                }`}
              >
                {job.tailoredResumeSlug ? "Resume ready" : "Not generated"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
