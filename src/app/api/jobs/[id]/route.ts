import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { updateJobSchema } from "@/lib/validation/job";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]">
) {
  const { id } = await ctx.params;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = updateJobSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid job payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(jobs)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(jobs.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job: updated });
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]">
) {
  const { id } = await ctx.params;
  const [deleted] = await db.delete(jobs).where(eq(jobs.id, id)).returning();

  if (!deleted) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
