import { createClient } from "@supabase/supabase-js";

const BUCKET = "resumes";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function uploadResumePdf(
  slug: string,
  buffer: Buffer
): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${slug}.pdf`, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) throw error;
}

export async function downloadResumePdf(slug: string): Promise<Buffer> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(`${slug}.pdf`);
  if (error || !data) {
    throw error ?? new Error("Resume not found in storage");
  }
  return Buffer.from(await data.arrayBuffer());
}
