import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs, applicationQuestions } from "@/lib/db/schema";
import { scrapeApplicationQuestions } from "@/lib/scraping";

function normalize(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]/scrape-questions">
) {
  const { id } = await ctx.params;

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!job.applyUrl) {
    return NextResponse.json(
      { error: "No apply URL on file for this job — add one first." },
      { status: 400 }
    );
  }

  const result = await scrapeApplicationQuestions(job.applyUrl);

  const existing = await db
    .select()
    .from(applicationQuestions)
    .where(eq(applicationQuestions.jobId, id));
  const existingNormalized = new Set(existing.map((q) => normalize(q.prompt)));

  let added = 0;
  let skipped = 0;
  for (const q of result.questions) {
    const key = normalize(q.prompt);
    if (existingNormalized.has(key)) {
      skipped++;
      continue;
    }
    await db.insert(applicationQuestions).values({
      jobId: id,
      prompt: q.prompt,
      status: "needs_draft",
      source: result.source,
    });
    existingNormalized.add(key);
    added++;
  }

  await db
    .update(jobs)
    .set({ applicationPromptsScannedAt: new Date(), updatedAt: new Date() })
    .where(eq(jobs.id, id));

  const questions = await db
    .select()
    .from(applicationQuestions)
    .where(eq(applicationQuestions.jobId, id));

  return NextResponse.json({
    found: result.questions.length,
    added,
    skipped,
    source: result.source,
    warnings: result.warnings,
    questions,
  });
}
