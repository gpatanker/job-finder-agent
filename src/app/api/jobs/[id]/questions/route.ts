import { NextResponse, type NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { applicationQuestions } from "@/lib/db/schema";
import { createQuestionSchema } from "@/lib/validation/question";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]/questions">
) {
  const { id } = await ctx.params;
  const questions = await db
    .select()
    .from(applicationQuestions)
    .where(eq(applicationQuestions.jobId, id))
    .orderBy(asc(applicationQuestions.createdAt));
  return NextResponse.json({ questions });
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]/questions">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = createQuestionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid question payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const [created] = await db
    .insert(applicationQuestions)
    .values({
      jobId: id,
      prompt: parsed.data.prompt,
      answer: parsed.data.answer,
      source: parsed.data.source,
      status: parsed.data.answer ? "drafted" : "needs_draft",
    })
    .returning();

  return NextResponse.json({ question: created }, { status: 201 });
}
