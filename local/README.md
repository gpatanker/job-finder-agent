# Your personal data goes here

This directory is gitignored (except this file and the `*.example.json`
templates) — nothing personal from here is ever committed to the public repo.

To seed your own candidate profile, resume, and story bank:

1. Copy the three example templates and fill in your own information:
   ```
   cp local/profile.example.json local/profile.seed.json
   cp local/resume.example.json local/resume.seed.json
   cp local/story-bank.example.json local/story-bank.seed.json
   ```
2. Edit those `*.seed.json` files with your real details. See the shape
   reference below.
3. Run the seed script (reads `DATABASE_URL` from `.env.local`):
   ```
   npm run db:seed-profile
   ```

Re-running the seed script is safe — `candidate_profile` and `resume_profile`
are singleton tables that get replaced wholesale, and `story_bank_entries` are
upserted by `slug`, so editing a seed file and re-running just updates
what's there.

## File shapes

- **profile.seed.json** — your contact info, work-authorization defaults,
  job-search criteria (role families, locations, salary floor, industries),
  and optional EEO/demographic self-identification (`genderIdentity`,
  `raceEthnicity`, `sexualOrientation`, `veteranStatus` — free text, leave
  any blank to have the Apply Run Brief tell the automation to select
  "decline to answer" for it instead).
- **resume.seed.json** — your base resume as structured data, not a static
  file. Each bullet has a stable `id`, `keywords`, and a `synonyms` map (a
  small set of pre-approved phrasing swaps for that bullet only). The Resume
  Tailoring Agent can only reorder bullets and pick among these pre-approved
  synonyms — it never invents new bullet text.
- **story-bank.seed.json** — an array of stories (`slug`, `title`, `tags`,
  `content`) used to ground generated interview/application answers. Keep
  these truthful — answer generation is grounded strictly in what's here.
