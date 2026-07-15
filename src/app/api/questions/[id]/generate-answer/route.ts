import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { applicationQuestions, jobs, questionBankEntries, storyBankEntries } from "@/lib/db/schema";
import { generateAnswer } from "@/lib/answers/generate-answer";

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/questions/[id]/generate-answer">
) {
  const { id } = await ctx.params;

  const [question] = await db
    .select()
    .from(applicationQuestions)
    .where(eq(applicationQuestions.id, id));
  if (!question) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, question.jobId));
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const [stories, questionBank] = await Promise.all([
    db.select().from(storyBankEntries),
    db.select().from(questionBankEntries),
  ]);

  if (stories.length === 0 && questionBank.length === 0) {
    return NextResponse.json(
      {
        error:
          "No story bank or question bank entries seeded yet. Add some in Settings, or fill in local/story-bank.seed.json / local/question-bank.seed.json and run `npm run db:seed-profile`.",
      },
      { status: 400 }
    );
  }

  const { answer, sourceStories, matchedQuestionBank } = await generateAnswer({
    prompt: question.prompt,
    company: job.company,
    title: job.title,
    jobDescription: job.jobDescription,
    stories,
    questionBank,
  });

  if (!answer) {
    return NextResponse.json(
      { error: "Couldn't find a relevant story or question-bank match to ground an answer in for this prompt." },
      { status: 422 }
    );
  }

  const [updated] = await db
    .update(applicationQuestions)
    .set({
      answer,
      status: question.status === "needs_draft" ? "drafted" : question.status,
      updatedAt: new Date(),
    })
    .where(eq(applicationQuestions.id, id))
    .returning();

  return NextResponse.json({ question: updated, sourceStories, matchedQuestionBank });
}
