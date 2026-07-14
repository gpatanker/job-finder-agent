import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { storyBankEntries } from "@/lib/db/schema";
import { updateStorySchema } from "@/lib/validation/settings";

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/settings/stories/[id]">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = updateStorySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid story payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(storyBankEntries)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(storyBankEntries.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  return NextResponse.json({ story: updated });
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/settings/stories/[id]">
) {
  const { id } = await ctx.params;
  const [deleted] = await db
    .delete(storyBankEntries)
    .where(eq(storyBankEntries.id, id))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
