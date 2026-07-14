import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { createJobSchema } from "@/lib/validation/job";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const approvalStatus = searchParams.get("approvalStatus");
  const q = searchParams.get("q");

  const conditions = [];

  if (process.env.SEED_DEMO_DATA !== "1") {
    conditions.push(eq(jobs.isSample, false));
  }
  if (status) {
    conditions.push(eq(jobs.status, status));
  }
  if (approvalStatus) {
    conditions.push(eq(jobs.approvalStatus, approvalStatus));
  }
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(ilike(jobs.company, pattern), ilike(jobs.title, pattern))
    );
  }

  const rows = await db
    .select()
    .from(jobs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(jobs.updatedAt));

  return NextResponse.json({ jobs: rows });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createJobSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid job payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const [created] = await db.insert(jobs).values(parsed.data).returning();

  return NextResponse.json({ job: created }, { status: 201 });
}
