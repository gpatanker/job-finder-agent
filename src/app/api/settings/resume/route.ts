import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { resumeProfile } from "@/lib/db/schema";
import { resumeDataSchema } from "@/lib/validation/settings";

export async function GET() {
  const [resume] = await db.select().from(resumeProfile).limit(1);
  return NextResponse.json({ resume: resume ?? null });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const parsed = resumeDataSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid resume data", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const [existing] = await db.select().from(resumeProfile).limit(1);

  if (!existing) {
    const [created] = await db
      .insert(resumeProfile)
      .values({ data: parsed.data })
      .returning();
    return NextResponse.json({ resume: created }, { status: 201 });
  }

  const [updated] = await db
    .update(resumeProfile)
    .set({ data: parsed.data, updatedAt: new Date() })
    .where(eq(resumeProfile.id, existing.id))
    .returning();

  return NextResponse.json({ resume: updated });
}
