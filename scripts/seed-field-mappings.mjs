// Seeds generic, non-personal platform/question -> answer mappings — UX-default
// preferences (e.g. which "how did you hear about us" option to pick), not
// candidate profile facts. Anything that encodes a real profile value (e.g.
// an actual degree level) belongs in a gitignored local seed instead, never
// here — this file is committed. Safe to re-run (upserts by platform +
// question_pattern).
const MAPPINGS = [
  {
    platform: "greenhouse",
    questionPattern: "how did you hear about this opportunity",
    answerValue: "LinkedIn Jobs",
    notes: "falls back to closest LinkedIn-flavored option if exact label differs",
  },
  {
    platform: "greenhouse",
    questionPattern: "where have you learned about",
    answerValue: "LinkedIn",
    notes: "multi-select variant of the how-did-you-hear question",
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Run with: npm run db:seed-field-mappings");
    process.exit(1);
  }

  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });

  for (const m of MAPPINGS) {
    await sql`
      insert into platform_field_mappings (platform, question_pattern, answer_value, notes)
      values (${m.platform}, ${m.questionPattern}, ${m.answerValue}, ${m.notes})
      on conflict (platform, question_pattern) do update set
        answer_value = excluded.answer_value,
        notes = excluded.notes,
        updated_at = now()
    `;
  }
  console.log(`platform_field_mappings seeded (${MAPPINGS.length} entries)`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
