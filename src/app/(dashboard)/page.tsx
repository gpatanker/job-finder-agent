import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";

export default async function OverviewPage() {
  const allJobs = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.isSample, false));

  const total = allJobs.length;
  const countOf = (status: string) =>
    allJobs.filter((j) => j.status === status).length;

  const stats = [
    { label: "Total jobs", value: total },
    { label: "Approved", value: countOf("approved") },
    { label: "Ready to apply", value: countOf("ready_to_apply") },
    { label: "Queued", value: countOf("queued") },
    { label: "Applied", value: countOf("applied") },
    { label: "Blocked", value: countOf("blocked") },
  ];

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Overview</h1>

      {total === 0 ? (
        <p
          className="text-sm text-black/60 dark:text-white/60"
          data-testid="overview-empty"
        >
          No jobs yet. Head to Pipeline to add your first one.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-black/10 p-4 dark:border-white/15"
              data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <p className="text-2xl font-semibold">{stat.value}</p>
              <p className="text-xs text-black/60 dark:text-white/60">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
