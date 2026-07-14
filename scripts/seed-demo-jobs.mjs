// Seeds a few generic, clearly-fake job rows with is_sample=true so a fresh
// clone of this repo can see the Pipeline/Tailor/Packet UI working before
// wiring up a real profile. Only runs when SEED_DEMO_DATA=1 — never in
// normal use, and never mixed with real jobs (all list queries filter
// is_sample=false unless that flag is set).
import postgres from "postgres";

async function main() {
  if (process.env.SEED_DEMO_DATA !== "1") {
    console.error("SEED_DEMO_DATA is not set to 1 — refusing to seed demo jobs. This is intentional.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Run with: npm run db:seed-demo");
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });

  const demoJobs = [
    {
      company: "Example Cloud Co",
      title: "Business Operations Manager",
      location: "Remote",
      work_mode: "remote",
      source_platform: "demo",
      apply_url: "https://example.com/careers/bizops-manager",
      salary_text: "$120k-$150k",
      match_score: 88,
      status: "discovered",
      approval_status: "pending",
      role_family: "Business Operations",
    },
    {
      company: "Sample Infra Inc",
      title: "Strategy & Operations Associate",
      location: "San Francisco, CA",
      work_mode: "hybrid",
      source_platform: "demo",
      apply_url: "https://example.com/careers/strategy-ops",
      salary_text: "$110k-$140k",
      match_score: 76,
      status: "needs_review",
      approval_status: "pending",
      role_family: "Strategy & Operations",
    },
  ];

  for (const job of demoJobs) {
    await sql`
      insert into jobs (company, title, location, work_mode, source_platform, apply_url,
        salary_text, match_score, status, approval_status, role_family, is_sample)
      values (${job.company}, ${job.title}, ${job.location}, ${job.work_mode},
        ${job.source_platform}, ${job.apply_url}, ${job.salary_text}, ${job.match_score},
        ${job.status}, ${job.approval_status}, ${job.role_family}, true)
    `;
  }

  console.log(`Seeded ${demoJobs.length} demo jobs (is_sample=true).`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
