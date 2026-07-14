import { NextResponse, type NextRequest } from "next/server";
import { downloadResumePdf } from "@/lib/storage/resumes";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/resumes/[slug]">
) {
  const { slug } = await ctx.params;

  try {
    const buffer = await downloadResumePdf(slug);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${slug}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }
}
