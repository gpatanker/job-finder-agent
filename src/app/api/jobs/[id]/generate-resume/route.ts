import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs, resumeProfile } from "@/lib/db/schema";
import { generateTailoringPlan } from "@/lib/resume/tailoring-agent";
import { applyTailoring } from "@/lib/resume/apply-tailoring";
import { renderResumePdf } from "@/lib/resume/render-pdf";
import { fitPlanToOnePage } from "@/lib/resume/fit-one-page";
import { scoreCoverage } from "@/lib/resume/keyword-coverage";
import { getCompanyContext, formatCompanyContext } from "@/lib/company/company-context";
import { resumeSlugForJob } from "@/lib/resume/slug";
import { uploadResumePdf } from "@/lib/storage/resumes";
import { fetchJobPostingText } from "@/lib/search/fetch-posting-text";

// Long-running: LLM calls plus network verification. Without this the
// platform's short default duration kills the function mid-run and returns an
// HTML error the client can't parse as JSON. See search/run for measurements.
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]/generate-resume">
) {
  const { id } = await ctx.params;

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const [resume] = await db.select().from(resumeProfile).limit(1);
  if (!resume) {
    return NextResponse.json(
      {
        error:
          "No base resume seeded yet. Fill in local/resume.seed.json and run `npm run db:seed-profile`, or add one in Settings.",
      },
      { status: 400 }
    );
  }

  // Backfill for jobs promoted before the fetch was added at promote-time
  // (or where that fetch failed) — without this, tailoring/coverage
  // scoring falls back to scoring against `resumeAngle`, a 1-2 sentence
  // marketing blurb, not the job's actual requirements text.
  let jobDescription = job.jobDescription;
  if (!jobDescription && job.applyUrl) {
    jobDescription = await fetchJobPostingText(job.applyUrl).catch(() => null);
  }

  // Cached employer research — what the company actually does, and what it
  // likely values in an ops hire. Null when unavailable; tailoring proceeds
  // exactly as before in that case.
  const companyProfile = await getCompanyContext(job.company);

  const context = [
    jobDescription,
    job.roleFamily,
    job.resumeAngle,
    job.title,
    job.company,
    formatCompanyContext(companyProfile),
  ]
    .filter(Boolean)
    .join("\n");

  const rawPlan = await generateTailoringPlan(resume.data, context, job.id);

  // The resume must stay one page. Bullet rewording can add length, and the
  // master layout sits right at the page boundary, so the fit is verified
  // against the actual rendered PDF rather than estimated from character counts.
  const fit = await fitPlanToOnePage(resume.data, rawPlan, (data) =>
    renderResumePdf(data, { title: `${job.company} — ${job.title} — Resume` })
  );
  const plan = fit.plan;
  const tailored = applyTailoring(resume.data, plan);
  const pdfBuffer = fit.pdf;

  // Re-score against what actually shipped. The agent's own coverage number was
  // computed before the one-page fit gave rewrites back, so it can overstate the
  // PDF the candidate sends.
  plan.coverageScore = jobDescription ? scoreCoverage(tailored, jobDescription) : plan.coverageScore;

  if (fit.droppedRewrites.length > 0 || fit.droppedSwaps.length > 0) {
    console.warn(
      `[generate-resume] ${job.company} — ${job.title}: gave back ${fit.droppedRewrites.length} rewrite(s) and ${fit.droppedSwaps.length} synonym swap(s) to stay on one page`
    );
  }
  if (fit.overflowsWithoutRewrites) {
    console.warn(
      `[generate-resume] ${job.company} — ${job.title}: resume is ${fit.pages} pages even with no rewording — the master resume itself is too long for one page.`
    );
  }

  const slug = resumeSlugForJob(job.company, job.title, job.id);
  await uploadResumePdf(slug, pdfBuffer);

  const fileName = `${slug}.pdf`;
  const [updated] = await db
    .update(jobs)
    .set({
      jobDescription,
      tailoredResumeSlug: slug,
      tailoredResumeFileName: fileName,
      tailoredResumeGeneratedAt: new Date(),
      tailoringPlan: plan,
      resumeCoverageScore: plan.coverageScore ?? null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, id))
    .returning();

  return NextResponse.json({ job: updated, plan });
}
