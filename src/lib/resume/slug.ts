export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resumeSlugForJob(company: string, title: string, jobId: string): string {
  return slugify(`${company}-${title}-${jobId.slice(0, 8)}`);
}
