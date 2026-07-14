import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { buildApplyRunBrief } from "@/lib/apply/brief";
import { getApprovedQuestions, getCandidateProfileOrThrow } from "@/lib/apply/data";

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]/apply-brief">
) {
  const { id } = await ctx.params;
  const submitAuthorized = request.nextUrl.searchParams.get("submitAuthorized") === "true";

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  let profile;
  try {
    profile = await getCandidateProfileOrThrow();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No candidate profile seeded" },
      { status: 400 }
    );
  }

  const approvedQuestions = await getApprovedQuestions(id);
  const brief = buildApplyRunBrief({
    job,
    profile,
    approvedQuestions,
    submitAuthorized,
    resumeRoute: job.tailoredResumeSlug ? `/api/resumes/${job.tailoredResumeSlug}` : null,
  });

  return NextResponse.json({ brief });
}
