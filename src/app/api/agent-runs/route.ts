import { NextResponse, type NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentRunQueue } from "@/lib/db/schema";
import { createAgentRunSchema } from "@/lib/validation/agent-run";
import { createAgentRun } from "@/lib/apply/create-run";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");
  const runs = await db
    .select()
    .from(agentRunQueue)
    .where(status ? eq(agentRunQueue.status, status) : undefined)
    .orderBy(desc(agentRunQueue.createdAt));
  return NextResponse.json({ runs });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createAgentRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid agent run payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const result = await createAgentRun(parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, run: result.existingRun },
      { status: result.status }
    );
  }

  return NextResponse.json({ run: result.run }, { status: 201 });
}
