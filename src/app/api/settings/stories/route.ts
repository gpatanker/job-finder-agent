import { NextResponse, type NextRequest } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { storyBankEntries } from "@/lib/db/schema";
import { createStorySchema } from "@/lib/validation/settings";

export async function GET() {
  const stories = await db
    .select()
    .from(storyBankEntries)
    .orderBy(asc(storyBankEntries.title));
  return NextResponse.json({ stories });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createStorySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid story payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const [created] = await db
      .insert(storyBankEntries)
      .values(parsed.data)
      .returning();
    return NextResponse.json({ story: created }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message.includes("unique")) {
      return NextResponse.json(
        { error: `A story with slug "${parsed.data.slug}" already exists` },
        { status: 409 }
      );
    }
    throw err;
  }
}
