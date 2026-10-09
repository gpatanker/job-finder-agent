# Forking this for yourself

This is a single-user tool by design (see [ROADMAP.md](ROADMAP.md)) — there is no
"add a second user" path. The new person needs their own fork, their own Supabase
project, their own API keys, and their own candidate data. Nothing about the
*code* needs to change; everything about the *data and defaults* does.

If you are an LLM setting this up for someone, read this file top to bottom first.
`HANDOFF.md` is the original author's own operational log — useful context, not a
checklist, and most of it is specific to their pipeline rather than yours.

**That last sentence used to be false for anyone outside operations, and is now true.** The title classifier's vocabulary — the required head noun, the domain tiers, the exclusions, the seniority band, and the candidate-specific half of the scoring rubric — was hardcoded to Business/Strategy Operations, so `classifyRoleFamily("Product Manager")` returned null and a product candidate's own target roles were rejected by the free job-board channel before scoring ran. That vocabulary now lives in `searchCriteria.roleScope`, and it is **generated from the candidate's own words** rather than hand-written: put what they're looking for in `searchCriteria.targetStatement` and run `npm run db:derive-role-scope`. Search refuses to run until a scope exists — there is no safe default, since the built-in fallback is this instance's operations scope in which "engineer" is a disqualifying term. Presets (`ops`, `product`) remain as shortcuts and as the output shape. See `src/lib/search/role-scope.ts`, `role-scope-agent.ts`, and `local/README.md`.

### Three layers that need personalizing

1. **Infra & accounts** — a new Supabase project, Anthropic API key, Perplexity API key, `.env.local`, and a Supabase Auth login user. Purely mechanical, already fully documented in [README.md](README.md)'s "Getting your own instance running" and [DEPLOYMENT.md](DEPLOYMENT.md) — follow those verbatim, nothing candidate-specific in that part.
2. **Structured candidate data**, seeded into the database from gitignored `local/*.seed.json` files — profile, resume, story bank, question bank. This is what makes the app work for *them* specifically (what jobs it searches for, what resume it tailors, what answers it drafts). This is the bulk of what this section covers.
3. **Generated artefacts** — three things derived from your profile rather than hand-written: your role scope (`npm run db:derive-role-scope`), your standing application answers (`npm run db:generate-apply-defaults`), and the `Author` field on generated resume PDFs. You don't edit any of them directly; you set the profile and regenerate. See "What the repo no longer makes you clean up" at the bottom.

### Layer 2: run a discovery interview

Don't dump every question on the person at once — work through it in a few conversational passes, draft the file, let them correct it. Everything below maps to a real field the app uses (see `local/README.md` for exact shapes, `local/*.example.json` for templates) — this isn't small talk, every answer lands somewhere concrete.

**Pass 1 — identity & work authorization** (→ `profile.seed.json` top-level fields)
- Full legal name, email, phone, LinkedIn URL, current city/state/zip, current employer (if any)
- "Are you authorized to work in [country] without needing sponsorship, now or in the future?" — this becomes the standing default answer to that exact question on every application, so get it precise (citizen vs. green-card holder vs. someone who *will* need sponsorship all answer this differently, and getting it wrong is a real eligibility-gate risk, not a cosmetic one)
- Highest education level completed, plus full education history (school + degree, for the resume)
- Total years of relevant experience, self-reported — note this may not literally match the tailored resume's span, since resumes typically only show relevant roles, not a full work history
- Open to relocating? If a form offers a choice of office locations, which do they prefer?
- Optional EEO/demographic self-ID: gender identity, race/ethnicity, sexual orientation, veteran status, disability status. Say explicitly these are legally optional on every application and fine to leave blank — don't press if they'd rather skip.

**Pass 2 — what they're actually looking for** (→ `profile.seed.json.searchCriteria`)
- Exact job-title / role-family phrases to search for — be specific ("Business Operations Manager" and "Strategy & Operations" are meaningfully different search targets than just "operations")
- Any title-adjacent roles that are explicitly OUT of scope, and why. This matters more than it sounds — keyword matching alone over-includes. (The author's own instance has a rule that pure Finance/Engineering/Marketing-titled roles don't count even though they share vocabulary, but Ops/Strategy-*flavored* versions of those functions do. The point isn't to copy that rule — it's to draw out the new candidate's own equivalent distinction.)
- Target locations (cities, "Remote," or both), salary floor, target industries (and any industries to explicitly avoid)
- **Then capture it as `searchCriteria.targetStatement` and GENERATE the scope** — don't hand-author word lists. Write their own description of the role, level, and explicit exclusions into `targetStatement`, make sure `roleFamilies` names the same job, then run `npm run db:derive-role-scope` (dry run — it prints a generated scope plus a table showing how it classifies their stated targets and some near-misses). Read it WITH them, hand-edit anything wrong, then `-- --write`. The generated scope is checked in code against their stated `roleFamilies` and refused if it rejects them, which catches an inverted or over-broad exclusion list before it costs a week of empty searches. Note search now REFUSES to run until a scope is set rather than defaulting — the old default was this instance's operations scope, in which "engineer" is a disqualifying term, so a software engineer inheriting it got zero results and no explanation.

**Pass 3 — the resume, as structured data, not a file** (→ `resume.seed.json`)
This app doesn't take a PDF or Word doc — the resume is structured JSON so the tailoring agent can reorder bullets and swap in pre-approved synonyms without ever inventing new content. Ask them to paste their current resume text, then:
- Break each role into bullets, each with a stable `id`
- For each bullet, propose `keywords` (the skill/domain it demonstrates — this is what coverage-scoring and tailoring actually match against job descriptions) and a small `synonyms` map (2-3 alternate phrasings for the key verb/phrase only, e.g. `"Reduced": ["Reduced", "Cut", "Shortened"]`) — draft these yourself from the bullet's content and have them approve/edit; don't ask them to hand-write raw JSON
- Capture skills (grouped by category) and certifications the same way
- See `local/resume.example.json` for the exact shape to produce

**Pass 4 — story bank** (→ `story-bank.seed.json`)
Ask for the material behind commonly-asked prompts: greatest achievement, hardest problem solved, a conflict or negotiation example, a leadership example, something not on the resume, why this field/industry, a failure and what they learned from it. Keep it specific and truthful — answer generation is grounded *strictly* in whatever's here, so a thin story bank produces thin generated answers. Each entry needs a `slug`, `title`, `tags`, and `content` — see `local/story-bank.example.json`.

**Pass 5 — question bank (optional)** (→ `question-bank.seed.json`)
If they already have polished, pre-written answers to recurring prompts ("why do you want to work here," "tell us about yourself"), capture those directly instead of letting them get regenerated from the story bank every time. Each entry needs a list of `question_variants` (paraphrases meaning the same thing) and one `answer`. Skip this pass entirely if they have nothing pre-written — seeding gracefully skips a missing file.

### Layer 3: generate, don't hand-edit

After the interview, run two generators and read what they produce:

```bash
npm run db:seed-profile              # load the seed JSON you just wrote
npm run db:derive-role-scope         # prints a role scope; saves nothing
npm run db:derive-role-scope -- --write
npm run db:generate-apply-defaults   # writes the gitignored standing-answers.md
```

`db:derive-role-scope` turns the candidate's own description of what they want into the
word lists the title filter uses, and refuses a scope that rejects the role families they
named. `db:generate-apply-defaults` renders their standing answers from the profile into
`.claude/skills/apply-run/standing-answers.md`, which the apply-run skill reads and which
is gitignored. Anything with no answer on file renders as "NOT SET — ask the candidate",
so the skill asks instead of inheriting.

Read both outputs with the candidate before trusting them. If something is wrong, fix the
**profile** and regenerate rather than editing the generated file — re-running overwrites it.

Leave the **per-ATS technical gotchas** in `SKILL.md` alone (Greenhouse react-select
behaviour, the Ashby React-state notes, hidden Phone/Country fields, the hCaptcha hard
stops). Those are platform behaviours that apply to whoever is driving the forms, and they
were learned across hundreds of real submissions. Deleting them costs failed applications.

### What not to carry over

- Don't copy anyone else's actual answers, examples, or identifying details into the new candidate's files "as a starting point" — draft everything fresh from what they tell you.
- Claude Code's memory system (`~/.claude/projects/.../memory/`) is scoped by project directory path, so a fresh clone in a new directory starts with no memory automatically — nothing to clean up there, unless someone is (don't) reusing an existing clone/directory for the new person instead of cloning fresh.
- `local/*.seed.json` and `.claude/skills/apply-run/standing-answers.md` are gitignored — never commit them. The tracked `SKILL.md` carries no personal data any more, so there is nothing to scrub there; if you find a name in it, that's a bug worth reporting upstream.

### Before the first real apply run

Confirm: `.env.local` is filled in and `npm run dev` boots, `npm run db:seed-profile` ran clean, the Supabase Auth login works, `npm run db:derive-role-scope -- --write` has saved a scope, and `npm run db:generate-apply-defaults` reports no unset fields you can't live with (anything still unset means the apply run will stop and ask). Then proceed exactly as the rest of this file and [ARCHITECTURE.md](ARCHITECTURE.md) describe — the pipeline mechanics don't change per candidate, only the data does.

### What the repo no longer makes you clean up

Three things used to be manual de-personalisation steps, and each one silently
sent *the original author's* details out on real applications if you skipped it.
They are structural now, so there is nothing to remember:

- **Standing application answers** are generated from your profile into
  `.claude/skills/apply-run/standing-answers.md`, which is gitignored. Run
  `npm run db:generate-apply-defaults` after seeding. The tracked skill file holds
  only ATS behaviour, which is shared knowledge, and points at the generated file.
  A field with no answer on file renders as "NOT SET — ask the candidate" instead
  of falling back to someone else's answer.
- **Resume PDF metadata** takes its `Author` from the resume being rendered, so
  generated PDFs carry your name rather than a hardcoded one. That field is
  readable by any ATS and nobody thinks to check it.
- **The role scope** — what counts as your kind of job — is generated from your own
  description by `npm run db:derive-role-scope`. Search refuses to run until it is
  set, rather than defaulting to the author's operations scope.

What you SHOULD still replace is `HANDOFF.md` itself: it is ~480 lines of the
original author's job-search history, including company names and interview
records. Keep a short starter version and write your own as you go.
