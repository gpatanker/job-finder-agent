import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobSearchSuggestions, jobs } from "@/lib/db/schema";
import { fetchJobPostingText } from "@/lib/search/fetch-posting-text";

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

  // The suggestion only ever carried a 1-2 sentence LLM-written rationale,
  // never the actual posting text — fetch the real job description now so
  // resume tailoring/coverage scoring (src/lib/resume/*) has real
  // requirements text to work against instead of scoring a resume against
  // marketing-blurb prose. Fails open (leaves jobDescription null) on any
  // fetch error rather than blocking promotion on a scraping failure —
  // generate-resume falls back to resumeAngle when this is null.
  const jobDescription = suggestion.applyUrl
    ? await fetchJobPostingText(suggestion.applyUrl).catch(() => null)
    : null;

  const [job] = await db
    .insert(jobs)
    .values({
      company: suggestion.company,
      title: suggestion.title,
      location: suggestion.location,
      workMode: suggestion.workMode,
      applyUrl: suggestion.applyUrl,
      jobDescription,
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
