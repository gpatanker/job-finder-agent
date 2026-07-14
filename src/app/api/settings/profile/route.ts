import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { candidateProfile } from "@/lib/db/schema";
import { updateCandidateProfileSchema } from "@/lib/validation/settings";

export async function GET() {
  const [profile] = await db.select().from(candidateProfile).limit(1);
  return NextResponse.json({ profile: profile ?? null });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const parsed = updateCandidateProfileSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid profile payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const [existing] = await db.select().from(candidateProfile).limit(1);

  if (!existing) {
    const [created] = await db
      .insert(candidateProfile)
      .values(parsed.data)
      .returning();
    return NextResponse.json({ profile: created }, { status: 201 });
  }

  const [updated] = await db
    .update(candidateProfile)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(candidateProfile.id, existing.id))
    .returning();

  return NextResponse.json({ profile: updated });
}
