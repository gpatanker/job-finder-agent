import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { FileText } from "lucide-react";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default async function TailorIndexPage() {
  const allJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.isSample, false))
    .orderBy(desc(jobs.updatedAt));

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <PageHeader
        title="Resume Tailor"
        description="Generate a role-tailored resume PDF for any job in your pipeline."
      />

      {allJobs.length === 0 ? (
        <Card>
          <CardContent
            className="py-12 text-center text-sm text-muted-foreground"
            data-testid="tailor-empty"
          >
            No jobs yet. Add one in Pipeline first.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y divide-border">
            {allJobs.map((job) => (
              <Link
                key={job.id}
                href={`/tailor/${job.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-secondary/40"
                data-testid={`tailor-link-${job.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">{job.company}</p>
                    <p className="text-muted-foreground">{job.title}</p>
                  </div>
                </div>
                <Badge variant={job.tailoredResumeSlug ? "success" : "neutral"}>
                  {job.tailoredResumeSlug ? "Resume ready" : "Not generated"}
                </Badge>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </main>
  );
}
