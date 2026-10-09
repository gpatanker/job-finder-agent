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
4. Generate the two things that are derived from the profile rather than
   written by hand — your role scope (what counts as your kind of job) and
   your standing application answers:
   ```
   npm run db:derive-role-scope          # prints a scope; saves nothing
   npm run db:derive-role-scope -- --write
   npm run db:generate-apply-defaults    # writes the gitignored standing-answers.md
   ```
   Re-run both whenever the profile changes.

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

  **Set `searchCriteria.targetStatement` and then generate your `roleScope`.**
  `roleScope` is the word lists the job-title filter uses to decide which of the
  thousands of open postings on ~165 boards are even your function. It is not
  optional and there is no safe default: the built-in fallback is one specific
  candidate's *operations* scope, in which `"engineer"` is a disqualifying term,
  so a software engineer who skipped this would get zero results and no
  explanation. Search refuses to run until it is set.

  You don't write it by hand. Describe what you want, then generate it:

  ```jsonc
  "searchCriteria": {
    "roleFamilies": ["Senior Software Engineer", "Backend Engineer", "Staff Engineer"],
    "targetStatement": "Backend software engineer, 6 years. Senior or Staff IC roles at
                        infrastructure or developer-tools companies. Not management,
                        not frontend, not ML research, not hardware."
  }
  ```

  ```bash
  npm run db:seed-profile          # load the above
  npm run db:derive-role-scope     # generate a scope and PRINT it — saves nothing
  npm run db:derive-role-scope -- --write   # save it once you've read it
  ```

  The dry run shows the generated word lists plus a table of how they classify
  your stated targets and some deliberate near-misses, so you can see the gate
  working before you trust it. `roleFamilies` and `targetStatement` must
  describe the **same** job — the generated scope is checked against those
  titles and rejected if it doesn't accept them, which is what catches an
  inverted or over-broad exclusion list.

  Hand-editing is expected and supported: paste the JSON into `roleScope` and
  change it. Keys beginning with `_` are ignored so you can leave yourself
  notes. `"roleScope": "ops"` or `"product"` takes a built-in preset as-is, and
  `{ "extends": "product", ... }` starts from one and overrides a few lists.

  Two fields matter more than the rest. **`bareHeadIsCore`**: `false` where the
  head noun alone is noise ("Operations Manager" — every profession has one),
  `true` where it is the job ("Software Engineer", "Product Manager"). And
  **`titlePhrases`**: the full job titles the *paid* search channel queries for,
  one per rotating query. These are what gets asked, as opposed to the other
  lists which filter what comes back — so if they name the wrong function you
  pay for searches you don't want. A product candidate measured 0 of 8 queries
  mentioning "product" before this was per-scope.

  **`applyDefaults` holds the standing answers that recur on every
  application** — visa status, which office you'd pick, how to answer a salary
  question, essay length, GPA if a form demands one. `npm run
  db:generate-apply-defaults` renders them into
  `.claude/skills/apply-run/standing-answers.md`, which is gitignored and which
  the `apply-run` skill reads instead of carrying anyone's personal answers in
  tracked prose. Every field in the template ships **blank on purpose**: a
  blank renders as `NOT SET — ask the candidate`, so the apply run stops and
  asks, while a pre-filled example phrase would be typed into a real
  employer's form by anyone who skipped the field. Guidance for each field is
  in a `_`-prefixed sibling key (`_visaStatus` next to `visaStatus`), which the
  reader ignores. Leave anything you're unsure about blank — being asked once
  per run is cheaper than one wrong answer on a live application.

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
