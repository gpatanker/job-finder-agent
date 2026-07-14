import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { applicationQuestions } from "@/lib/db/schema";
import { updateQuestionSchema } from "@/lib/validation/question";

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/questions/[id]">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = updateQuestionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid question payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(applicationQuestions)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(applicationQuestions.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  return NextResponse.json({ question: updated });
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/questions/[id]">
) {
  const { id } = await ctx.params;
  const [deleted] = await db
    .delete(applicationQuestions)
    .where(eq(applicationQuestions.id, id))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
