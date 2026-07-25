import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { analystReports } from "@/lib/db/schema";
import { checkAnalystEligibility } from "@/lib/analyst/eligibility";

export async function GET() {
  const [reports, eligibility] = await Promise.all([
    db.select().from(analystReports).orderBy(desc(analystReports.createdAt)).limit(20),
    checkAnalystEligibility(),
  ]);
  return NextResponse.json({ reports, eligibility });
}
