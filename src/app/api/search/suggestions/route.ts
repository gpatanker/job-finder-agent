import { NextResponse, type NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobSearchSuggestions } from "@/lib/db/schema";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") ?? "new";
  const suggestions = await db
    .select()
    .from(jobSearchSuggestions)
    .where(eq(jobSearchSuggestions.status, status))
    .orderBy(desc(jobSearchSuggestions.matchScore));
  return NextResponse.json({ suggestions });
}
