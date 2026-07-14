// Seeds candidate_profile / resume_profile / story_bank_entries from the
// gitignored local/*.seed.json files. Safe to re-run (idempotent): singleton
// tables are replaced wholesale, story bank entries are upserted by slug.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  try {
    return JSON.parse(readFileSync(fullPath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(
        `Missing ${relativePath} — this file holds your personal profile/resume/story-bank data and is intentionally gitignored. See local/README.md.`
      );
      process.exit(1);
    }
    throw err;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Run with: npm run db:seed-profile");
    process.exit(1);
  }

  const profile = readJson("local/profile.seed.json");
  const resume = readJson("local/resume.seed.json");
  const stories = readJson("local/story-bank.seed.json");

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });

  await sql`delete from candidate_profile`;
  await sql`
    insert into candidate_profile
      (name, email, phone, linkedin, location, current_company, function_tags,
       preferred_industries, work_authorized, requires_sponsorship,
       gender_identity, race_ethnicity, sexual_orientation, veteran_status,
       disability_status, zip_code, highest_education_level,
       requires_relocation_assistance, how_heard_default, ai_policy_agreement,
       education, search_criteria)
    values (
      ${profile.name}, ${profile.email}, ${profile.phone ?? null},
      ${profile.linkedin ?? null}, ${profile.location ?? null},
      ${profile.currentCompany ?? null},
      ${sql.json(profile.functionTags ?? [])},
      ${sql.json(profile.preferredIndustries ?? [])},
      ${profile.workAuthorized}, ${profile.requiresSponsorship},
      ${profile.genderIdentity || null}, ${profile.raceEthnicity || null},
      ${profile.sexualOrientation || null}, ${profile.veteranStatus || null},
      ${profile.disabilityStatus || null}, ${profile.zipCode || null},
      ${profile.highestEducationLevel || null},
      ${profile.requiresRelocationAssistance ?? false},
      ${profile.howHeardDefault || null}, ${profile.aiPolicyAgreement || null},
      ${sql.json(profile.education ?? [])},
      ${sql.json(profile.searchCriteria ?? null)}
    )
  `;
  console.log("candidate_profile seeded");

  await sql`delete from resume_profile`;
  await sql`insert into resume_profile (data) values (${sql.json(resume)})`;
  console.log("resume_profile seeded");

  for (const story of stories) {
    await sql`
      insert into story_bank_entries (slug, title, tags, content)
      values (${story.slug}, ${story.title}, ${sql.json(story.tags ?? [])}, ${story.content})
      on conflict (slug) do update set
        title = excluded.title,
        tags = excluded.tags,
        content = excluded.content,
        updated_at = now()
    `;
  }
  console.log(`story_bank_entries seeded (${stories.length} entries)`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
