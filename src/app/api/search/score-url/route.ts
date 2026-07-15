import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { candidateProfile, jobs, jobSearchSuggestions, resumeProfile } from "@/lib/db/schema";
import { scoreJobUrl } from "@/lib/search/score-job-url";

function normalize(company: string, title: string): string {
  return `${company}|${title}`.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "A job posting URL is required." }, { status: 400 });
  }
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid URL." }, { status: 400 });
  }

  const [profile] = await db.select().from(candidateProfile).limit(1);
  if (!profile) {
    return NextResponse.json(
      { error: "No candidate profile seeded yet. Fill in local/profile.seed.json and run `npm run db:seed-profile`, or add one in Settings." },
      { status: 400 }
    );
  }

  const [resume] = await db.select().from(resumeProfile).limit(1);
  if (!resume) {
    return NextResponse.json(
      { error: "No resume seeded yet. Fill in local/resume.seed.json and run `npm run db:seed-profile`, or add one in Settings." },
      { status: 400 }
    );
  }

  const scored = await scoreJobUrl({ url, profile, resume: resume.data });
  if (!scored.ok) {
    return NextResponse.json({ error: scored.error }, { status: 422 });
  }

  const { company, title, location, workMode, salaryText, matchScore, rationale } = scored.result;

  const [existingJobs, existingSuggestions] = await Promise.all([
    db.select({ company: jobs.company, title: jobs.title }).from(jobs),
    db
      .select({ company: jobSearchSuggestions.company, title: jobSearchSuggestions.title })
      .from(jobSearchSuggestions)
      .where(eq(jobSearchSuggestions.status, "new")),
  ]);
  const key = normalize(company, title);
  const alreadyKnown = [...existingJobs, ...existingSuggestions].some(
    (j) => normalize(j.company, j.title) === key
  );
  if (alreadyKnown) {
    return NextResponse.json(
      { error: `${company} — ${title} is already in your pipeline or suggestions.` },
      { status: 409 }
    );
  }

  const [suggestion] = await db
    .insert(jobSearchSuggestions)
    .values({
      company,
      title,
      location,
      workMode,
      applyUrl: url,
      sourceUrl: url,
      salaryText,
      matchScore,
      rationale,
    })
    .returning();

  return NextResponse.json({ suggestion });
}
