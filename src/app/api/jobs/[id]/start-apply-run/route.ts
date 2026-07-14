import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAgentRun } from "@/lib/apply/create-run";

const bodySchema = z.object({
  submitAuthorized: z.boolean().default(false),
  force: z.boolean().optional(),
});

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]/start-apply-run">
) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const result = await createAgentRun({ jobId: id, ...parsed.data });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, run: result.existingRun },
      { status: result.status }
    );
  }

  return NextResponse.json({ run: result.run }, { status: 201 });
}
