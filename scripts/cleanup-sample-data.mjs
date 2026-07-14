// Deletes all is_sample=true jobs and their dependent rows (application_questions,
// agent_run_queue cascade via FK). Never touches real (is_sample=false) jobs.
import postgres from "postgres";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Run with: npm run db:cleanup-demo");
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });

  const deleted = await sql`delete from jobs where is_sample = true returning id, company, title`;
  console.log(`Deleted ${deleted.length} sample job(s) and their dependent rows:`);
  for (const row of deleted) {
    console.log(`  - ${row.company} — ${row.title}`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
