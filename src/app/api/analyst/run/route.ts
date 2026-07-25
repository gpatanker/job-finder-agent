import { NextResponse } from "next/server";
import { checkAnalystEligibility } from "@/lib/analyst/eligibility";
import { runPipelineAnalyst } from "@/lib/analyst/pipeline-analyst";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const force = body?.force === true;

  const eligibility = await checkAnalystEligibility();

  if (!eligibility.eligible && !force) {
    return NextResponse.json({ ran: false, eligibility });
  }

  try {
    const { report } = await runPipelineAnalyst(eligibility);
    return NextResponse.json({ ran: true, report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Pipeline Analyst run failed" },
      { status: 500 }
    );
  }
}
