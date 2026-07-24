import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentRunQueue, jobs } from "@/lib/db/schema";
import { updateAgentRunSchema } from "@/lib/validation/agent-run";
import { computeJobStatusSideEffects } from "@/lib/pipeline/status-effects";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/agent-runs/[id]">
) {
  const { id } = await ctx.params;
  const [run] = await db.select().from(agentRunQueue).where(eq(agentRunQueue.id, id));
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ run });
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/agent-runs/[id]">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = updateAgentRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid agent run payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const [existing] = await db.select().from(agentRunQueue).where(eq(agentRunQueue.id, id));
  if (!existing) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // blockReason cascades to the jobs table below — agent_run_queue has no
  // such column itself.
  const { blockReason, ...runFields } = parsed.data;
  const patch: Record<string, unknown> = { ...runFields, updatedAt: new Date() };
  if (parsed.data.status === "in_progress" && !existing.startedAt) {
    patch.startedAt = new Date();
  }
  if (
    parsed.data.status &&
    ["completed", "blocked", "cancelled"].includes(parsed.data.status) &&
    !existing.completedAt
  ) {
    patch.completedAt = new Date();
  }

  const [updated] = await db
    .update(agentRunQueue)
    .set(patch)
    .where(eq(agentRunQueue.id, id))
    .returning();

  if (parsed.data.status) {
    const [existingJob] = await db.select().from(jobs).where(eq(jobs.id, existing.jobId));
    const jobStatus =
      parsed.data.status === "blocked"
        ? "blocked"
        : parsed.data.status === "completed"
          ? "applied"
          : undefined;
    const jobPatch: Record<string, unknown> = {
      applyAgentStatus: parsed.data.status,
      updatedAt: new Date(),
      ...(jobStatus ? { status: jobStatus } : {}),
      ...(blockReason ? { blockReason } : {}),
      ...(existingJob ? computeJobStatusSideEffects(existingJob, { status: jobStatus }) : {}),
    };
    await db.update(jobs).set(jobPatch).where(eq(jobs.id, existing.jobId));
  }

  return NextResponse.json({ run: updated });
}
