import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { analystReports } from "@/lib/db/schema";
import { checkAnalystEligibility } from "@/lib/analyst/eligibility";
import { PageHeader } from "@/components/ui/page-header";
import { AnalystClient } from "./analyst-client";

export default async function AnalystPage() {
  const [reports, eligibility] = await Promise.all([
    db.select().from(analystReports).orderBy(desc(analystReports.createdAt)).limit(20),
    checkAnalystEligibility(),
  ]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <PageHeader
        title="Pipeline Analyst"
        description="Claude Opus reviews your full application history — resume angles, coverage scores, cost, and which jobs turned into interviews — and writes up what's working. Triggered by new signal (a batch of applications or a new interview), not a fixed schedule. Never changes anything itself; you decide what to act on."
      />
      <AnalystClient initialReports={reports} initialEligibility={eligibility} />
    </main>
  );
}
