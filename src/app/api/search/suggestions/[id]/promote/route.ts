import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobSearchSuggestions, jobs } from "@/lib/db/schema";

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/search/suggestions/[id]/promote">
) {
  const { id } = await ctx.params;

  const [suggestion] = await db
    .select()
    .from(jobSearchSuggestions)
    .where(eq(jobSearchSuggestions.id, id));
  if (!suggestion) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }

  const [existing] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.company, suggestion.company), eq(jobs.title, suggestion.title)));

  if (existing) {
    await db
      .update(jobSearchSuggestions)
      .set({ status: "dismissed", updatedAt: new Date() })
      .where(eq(jobSearchSuggestions.id, id));
    return NextResponse.json(
      { error: `${suggestion.company} — ${suggestion.title} is already in your pipeline.`, job: existing },
      { status: 409 }
    );
  }

  const [job] = await db
    .insert(jobs)
    .values({
      company: suggestion.company,
      title: suggestion.title,
      location: suggestion.location,
      workMode: suggestion.workMode,
      applyUrl: suggestion.applyUrl,
      salaryText: suggestion.salaryText,
      matchScore: suggestion.matchScore,
      resumeAngle: suggestion.rationale,
      sourcePlatform: "job-search-agent",
      status: "discovered",
    })
    .returning();

  await db
    .update(jobSearchSuggestions)
    .set({ status: "promoted", updatedAt: new Date() })
    .where(eq(jobSearchSuggestions.id, id));

  return NextResponse.json({ job }, { status: 201 });
}
