import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs, resumeProfile } from "@/lib/db/schema";
import { generateTailoringPlan } from "@/lib/resume/tailoring-agent";
import { applyTailoring } from "@/lib/resume/apply-tailoring";
import { renderResumePdf } from "@/lib/resume/render-pdf";
import { resumeSlugForJob } from "@/lib/resume/slug";
import { uploadResumePdf } from "@/lib/storage/resumes";

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

  const context = [job.jobDescription, job.roleFamily, job.resumeAngle, job.title, job.company]
    .filter(Boolean)
    .join("\n");

  const plan = await generateTailoringPlan(resume.data, context);
  const tailored = applyTailoring(resume.data, plan);
  const pdfBuffer = await renderResumePdf(tailored, {
    title: `${job.company} — ${job.title} — Resume`,
  });

  const slug = resumeSlugForJob(job.company, job.title, job.id);
  await uploadResumePdf(slug, pdfBuffer);

  const fileName = `${slug}.pdf`;
  const [updated] = await db
    .update(jobs)
    .set({
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
