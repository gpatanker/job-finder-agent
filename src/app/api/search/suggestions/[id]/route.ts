import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { jobSearchSuggestions } from "@/lib/db/schema";

const patchSchema = z.object({
  status: z.enum(["new", "promoted", "dismissed"]),
});

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/search/suggestions/[id]">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const [updated] = await db
    .update(jobSearchSuggestions)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(jobSearchSuggestions.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }

  return NextResponse.json({ suggestion: updated });
}
