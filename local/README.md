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

  **If you are not in operations, set `searchCriteria.roleScope`.** It is the
  one field that decides what the title classifier counts as "your function",
  and it is the difference between the free job-board channel finding your
  roles and rejecting all of them. Omit it and you inherit the Business /
  Strategy Operations scope this project was first built for — under which
  `classifyRoleFamily("Product Manager")` returns null.

  Three ways to set it, cheapest first:

  ```jsonc
  // 1. Take a built-in preset as-is. Built-ins: "ops", "product".
  "roleScope": "product"

  // 2. Start from a preset and override a few lists.
  "roleScope": { "extends": "product", "disqualifyingDomains": ["marketing", "design"] }

  // 3. Spell one out in full — see src/lib/search/role-scope.ts for every
  //    field and the reasoning behind each.
  ```

  Keys beginning with `_` are ignored, so you can leave notes to yourself in
  the JSON. The field that catches people out is **`bareHeadIsCore`**: it must
  be `false` for operations, where a bare "Operations Manager" is noise because
  every profession has one, and `true` for product, where "Product Manager" is
  precisely the target rather than a title needing a qualifier.

  `rubricRules` is the candidate-specific half of the LLM's scoring prompt —
  your in-scope families, your hard exclusions each with a reason, and your
  seniority ceiling. The presets ship it empty on purpose: inheriting someone
  else's exclusions is worse than writing your own.
- **resume.seed.json** — your base resume as structured data, not a static
  file. Each bullet has a stable `id`, `keywords`, and a `synonyms` map (a
  small set of pre-approved phrasing swaps for that bullet only). The Resume
  Tailoring Agent can only reorder bullets and pick among these pre-approved
  synonyms — it never invents new bullet text.
- **story-bank.seed.json** — an array of stories (`slug`, `title`, `tags`,
  `content`) used to ground generated interview/application answers. Keep
  these truthful — answer generation is grounded strictly in what's here.
- **question-bank.seed.json** (optional) — a fixed bank of pre-written,
  already-polished answers to recurring application-question archetypes
  ("greatest achievement," "why this company," etc.), each keyed by a list
  of paraphrased `question_variants`. Checked first, before story-bank
  synthesis: an incoming question is matched against these (by meaning, not
  keywords — variants like "greatest achievement" and "proudest
  accomplishment" share almost no vocabulary) and the matched answer is
  adapted for the specific company/role rather than regenerated from
  scratch. Falls back to the story bank if nothing matches closely enough.
  Safe to omit — seeding skips it gracefully if the file isn't there.
