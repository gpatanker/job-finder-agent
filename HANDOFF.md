# Handoff — read this first in a new chat

**Purpose:** If this conversation is lost and you're starting fresh, read this file top to bottom before doing anything else. It captures the state, decisions, and hard-won operational knowledge that aren't visible just from reading the code. Update it as things change — it's meant to stay current, not be a one-time snapshot.

Last updated: 2026-10-02.

---

## What this project is

`job-finder-agent` is Gaurav Patanker's personal job-application command center. Full product description, stack, and setup steps live in [README.md](README.md), [DEPLOYMENT.md](DEPLOYMENT.md), [TESTING.md](TESTING.md), and [ROADMAP.md](ROADMAP.md) — read those for the "what" and "how to run it." **[ARCHITECTURE.md](ARCHITECTURE.md)** has the four-agent structural picture and a workflow diagram. This file is for the "where things stand" and "what to watch out for."

Core loop: the **Job Search Agent** (Perplexity Search API for discovery + one bounded Claude Sonnet call to structure/score — see below, not native `web_search` anymore) finds candidate postings → human promotes a suggestion into the pipeline → **Resume Tailoring Agent** generates a tailored PDF → application short-answer prompts get scraped and drafted → an **Apply Run** is queued with a full brief → a human (via Claude Code + Playwright MCP, in practice) actually fills and submits the form in a real browser, then closes it out through the real API (see below) to update `jobs`/`agentRunQueue` and close the loop. A fourth agent, the **Pipeline Analyst** (Claude Opus), periodically reviews the whole history for what's actually working — see below.

**The app itself never submits an application.** Submission always happens out-of-band, via Playwright browser automation driven by a Claude Code session (this is "the Computer" referenced in the UI/briefs).

## Forking this for a new candidate (not Gaurav)

If you're an LLM reading this because someone other than Gaurav Patanker wants to run their own instance, this section is your playbook — read it now, before the rest of the file. Everything below this section (architecture notes, search-pipeline bug history, Gaurav's own pipeline stats and role-family rules) is his instance's operational history, not instructions to follow for a new person; come back to it later for context, not as a checklist.

**The short version**: this is a single-user tool by design (see [ROADMAP.md](ROADMAP.md)) — there's no "add a second user to Gaurav's account." The new person needs their own fork, their own Supabase project, their own API keys, and their own candidate data. Nothing about the *code* needs to change; everything about the *data and defaults* does.

### Three layers that need personalizing

1. **Infra & accounts** — a new Supabase project, Anthropic API key, Perplexity API key, `.env.local`, and a Supabase Auth login user. Purely mechanical, already fully documented in [README.md](README.md)'s "Getting your own instance running" and [DEPLOYMENT.md](DEPLOYMENT.md) — follow those verbatim, nothing candidate-specific in that part.
2. **Structured candidate data**, seeded into the database from gitignored `local/*.seed.json` files — profile, resume, story bank, question bank. This is what makes the app work for *them* specifically (what jobs it searches for, what resume it tailors, what answers it drafts). This is the bulk of what this section covers.
3. **Standing default answers baked into the `apply-run` skill** (`.claude/skills/apply-run/SKILL.md`). Unlike `local/`, this file is **not** gitignored, and as of this writing it's full of Gaurav-specific facts: his name, email, GitHub URL, exact resume-filename convention, demographic defaults, salary-answer style, and role-family scope decisions. This is the file a Claude Code session actually reads before driving a live apply run — skip rewriting it and the new candidate's applications will go out with **Gaurav's** answers to recurring questions. Don't treat this as optional just because it isn't a seed file.

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
- Any title-adjacent roles that are explicitly OUT of scope, and why. This matters more than it sounds — keyword matching alone over-includes. (Gaurav's own instance has a rule that pure Finance/Engineering/Marketing-titled roles don't count even though they share vocabulary, but Ops/Strategy-*flavored* versions of those functions do. The point isn't to copy his rule — it's to draw out the new candidate's own equivalent distinction.)
- Target locations (cities, "Remote," or both), salary floor, target industries (and any industries to explicitly avoid)

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

### Layer 3: personalize the `apply-run` skill

After the interview, rewrite `.claude/skills/apply-run/SKILL.md`'s "Standing default answers" section (and the resume-filename note under it) using what you just gathered — same structure, new facts. Concretely, replace:
- Name, email, GitHub URL, and the resume-filename convention (currently hardcoded to `Gaurav_Patanker_Resume.pdf`)
- Work authorization / sponsorship default, "how did you hear about us" default, relocation/office-preference default, and salary-expectation answer style
- The demographic defaults (gender, race/ethnicity, veteran/disability status) — only fill these in if they gave you real answers in Pass 1; otherwise leave the skill saying "decline to answer" for these
- The essay-answer style guidance (length/tone), if they express a preference — otherwise the existing "~2 short paragraphs" default is reasonable to keep as-is
- Any role-family in/out-of-scope rule surfaced in Pass 2

Leave the **per-ATS technical gotchas** alone (Greenhouse combobox behavior, Ashby toggle-button verification, the DOM-ref-staleness pattern, etc.) — those are platform behaviors, not candidate-specific, and apply to whoever is driving these forms.

### What not to carry over

- Don't copy any of Gaurav's actual answers, examples, or identifying details into the new candidate's files "as a starting point" — draft everything fresh from what they tell you.
- Claude Code's memory system (`~/.claude/projects/.../memory/`) is scoped by project directory path, so a fresh clone in a new directory starts with no memory automatically — nothing to clean up there, unless someone is (don't) reusing Gaurav's existing clone/directory for the new person instead of cloning fresh.
- `local/*.seed.json` files are already gitignored — never commit them. `.claude/skills/apply-run/SKILL.md` is **not** gitignored, so before pushing, double-check it no longer contains Gaurav's name/email/GitHub URL once rewritten.

### Before the first real apply run

Confirm: `.env.local` is filled in and `npm run dev` boots, `npm run db:seed-profile` ran clean, the Supabase Auth login works, and a read-through of the rewritten `apply-run` skill turns up zero remaining references to Gaurav. Then proceed exactly as the rest of this file and [ARCHITECTURE.md](ARCHITECTURE.md) describe — the pipeline mechanics don't change per candidate, only the data does.

## Architecture quick-reference

- Next.js 16 (App Router, TypeScript, Turbopack), Supabase Postgres via Drizzle, deployed on Vercel.
- Key DB tables (`src/lib/db/schema.ts`): `jobs`, `applicationQuestions`, `agentRunQueue`, `candidateProfile`, `resumeProfile`, `platformFieldMappings`, `questionBankEntries`, `storyBankEntries`, `jobSearchSuggestions`.
  - `jobs.status` (`discovered` → `approved`/`blocked` → `queued` → `applied`/`blocked`) vs `jobs.approvalStatus` (`pending`/`approved`/`rejected`) vs `jobs.applyAgentStatus` (`queued`/`submitted`/`blocked`) are three **separate** fields. `approvalStatus` is only ever set by the Pipeline UI's "Approve" button — the apply-run pipeline (including the real-API close-out below) never touches it, so **every** job that reaches `applied`/`blocked`/`rejected`/`archived` via an apply run is left stuck at `approvalStatus = "pending"` forever unless someone runs a cleanup sweep. This has now recurred at least twice (a 47-job cleanup on 2026-07-2x, then a 4-job recurrence on 2026-07-24 from the very next batch) — it's a structural gap, not a one-off bug, and it'll keep recurring after every batch until it's fixed properly (e.g. having the close-out PATCH also set `approvalStatus: "approved"` when the terminal `jobs.status` is set). Until then, periodically run: `UPDATE jobs SET approval_status = 'approved' WHERE status IN ('applied','blocked','rejected','archived') AND approval_status = 'pending'` — otherwise the Overview page's "Pending review" / "Awaiting approval" tiles fill up with jobs that are actually fully resolved.
  - `jobs.appliedAt` and `jobs.blockReason` cascade automatically now (see the real-API close-out pattern below) but only for jobs closed out **after** the 2026-07-22 migration — most of the ~90 historical applied/blocked jobs predate it and have `appliedAt`/`blockReason` still null. This directly affects two Overview-page KPIs: "Avg. time to submit" and "Manual intervention rate" are computed only from `agentRunQueue` rows that have both `startedAt` and `completedAt` (as of 2026-07-24, that's ~9 of 97 runs) — the numbers shown are correct for that small timed sample, just not representative of the full historical run volume yet. This will self-correct as more runs go through the real-API pattern; no action needed, just don't be surprised the sample is small.
  - `agentRunQueue.submitAuthorized` gates whether the generated brief says "DO NOT SUBMIT, fill and stop" vs "submit if everything checks out." A run created with `requiresSponsorship: true` on the candidate profile (see below — this is stale/wrong) will auto-generate a `submitAuthorized: false` brief. When manually driving Playwright yourself under explicit user authorization, this flag doesn't block you — just remember to flip it to `true` in the DB afterward so the record is consistent.
- Live-ATS-board freshness verification (`src/lib/search/live-board.ts`, `src/lib/search/resolve-freshness.ts`): before trusting a search-discovered candidate URL, fetch the company's actual current job list from Greenhouse's or Ashby's public unauthenticated API and match against it — free, fast, and authoritative, vs. re-asking an LLM to search again. Detects Greenhouse (direct + embedded-widget via `gh_jid` param), Ashby, falls back to the old LLM-recovery path for anything else. Wired into `src/app/api/search/run/route.ts`, `src/app/api/search/clean/route.ts`, and `src/lib/apply/create-run.ts` (all three call sites — a past bug was fixing only two of three).
- **Job Search Agent is a two-step pipeline (rewritten 2026-07-27/28), not one long Claude+web_search conversation**: `discoverCandidatePostings()` in `src/lib/search/perplexity-discover.ts` fires several parallel requests against Perplexity's **Search API** (`POST https://api.perplexity.ai/search` — a raw ranked-results endpoint, `$5/1,000 requests` flat, no token billing; NOT the Sonar chat-completions models, which are a separate, token-billed product). `findJobCandidates()` in `src/lib/search/job-search-agent.ts` then makes one bounded Claude call (no `web_search` tool) to structure/dedupe/score whatever Perplexity found. Requires `PERPLEXITY_API_KEY` (perplexity.ai/settings/api, separate billing from a Pro subscription); if unset, Search/Import returns a warning and no candidates instead of failing outright.
  - **2026-07-27 diagnostic found the original design was silently self-defeating**, verified with ~40 live test queries against the same API: a run that day found 23 raw candidates and netted **0** new suggestions, while the same API queried properly in the diagnostic surfaced 157 unknown-to-the-DB deep links, 149 still open. Root causes, all fixed:
    1. Every query appended a growing "avoid these companies already heavily represented" instruction (`deprioritize` string) — measured as a **complete no-op at retrieval** (identical results with/without it; `/search` is ranked retrieval, not an instruction-follower) while eating 58-74% of every query's character budget as the overrepresented-company list grew. **Fix:** deleted from the query text entirely; that guidance now goes into the Claude structuring prompt instead (`job-search-agent.ts`), where it can actually be followed.
    2. **Zero query rotation** — the same static query strings ran every single run, and Perplexity's ranked results for a fixed query barely change hour-to-hour, so reruns mostly just re-fetched already-known postings. **Fix:** `ROLE_SYNONYM_POOL` in `perplexity-discover.ts` is a rotating pool of ~16 short, single-intent role phrases; `rotateSlice()` draws a different 8-phrase slice each day (deterministic day-based offset, no persisted cursor needed) and the widen/broaden pass draws the complementary disjoint slice rather than repeating pass 1 with a "focus on adjacent industries" suffix (also measured as a no-op).
    3. **Only 1 of 6 queries carried a domain filter** — the other 5 mostly returned board-landing pages and blocked/scraper aggregator sites that can never pass `specificity-check.ts`/`blocked-sources.ts`. **Fix:** `ATS_DOMAIN_FILTER` (Greenhouse, Ashby, Lever, Rippling, SmartRecruiters, Workable) is now applied to **every** query.
    4. `search_recency_filter: "month"` was a blanket default on every query. **Fix:** split into a fresh track (`search_after_date_filter` = last known suggestion's `createdAt` minus a 3-day safety buffer, computed fresh each run — no dedicated "last run" column needed) and a backfill track (no recency filter at all — safe because live-board verification, not recency, is what actually confirms a posting is still open).
  - **New zero-cost discovery channel**: `discoverFromKnownCompanyBoards()` in `src/lib/search/known-company-boards.ts` directly polls the live Greenhouse/Ashby board API for every company already in `jobs`/`jobSearchSuggestions` (no Perplexity request, no LLM call — just the same free live-board fetch `resolve-freshness.ts` already does for verification) and returns any currently-open posting whose title matches the target role families. Flagged in the diagnostic as the single highest-ROI addition given ~90+ known companies with resolvable board tokens. Runs in parallel with the Perplexity pass in `route.ts`.
  - **Two related bugs fixed in the same pass**: `specificity-check.ts` now rejects bare ATS board-root URLs with no job ID (`job-boards.greenhouse.io/{token}` with nothing after it, e.g. the real case `job-boards.greenhouse.io/snorkelai?error=true`, which previously slipped through since the token itself isn't an enumerable "generic" path segment). `live-board.ts`'s `matchLiveJob` now checks title overlap in **both** directions — the original one-directional check could wrongly mark a posting closed when the LLM-extracted candidate title was longer/more qualified than the board's own shorter title (e.g. "Senior GTM Strategy & Operations Manager, Enterprise" vs. the board's plain "GTM Strategy & Ops Manager").
  - **Validated 2026-07-28**: same-day rerun immediately after shipping these fixes found 289 raw candidates (up from 23) and added **65 net-new suggestions across 43 companies** (up from 0). The per-company diversity cap (`MAX_NEW_SUGGESTIONS_PER_COMPANY` in `route.ts`) alone filtered 127 of those 289 — clearly the binding constraint now that real volume is flowing — so it was raised from 2 to 4 in the same pass. Industry-context queries (AI/cloud/infra, energy/climate, defense/govtech) stay deliberately separate narrow queries, not merged into one — a 2026-07-22 diagnostic found merging them makes Perplexity default to whichever term is most emphasized ("AI" drowning out everything else); this is unchanged by the 07-27/28 rewrite, don't re-merge them.
  - **The 65-suggestion validation run itself turned out to be low-precision — fixed same day (2026-07-28, second pass).** Manual review of the results surfaced real garbage from the new `known-company-boards.ts` channel: Recruiting/Warehouse/HR Ops roles, a non-US Guadalajara posting, and (worst case) a Databricks listing written entirely in Japanese ("ソリューションアーキテクト (プリセールス)" — Solution Architect, Pre-sales) — all scored a flat 55/100. Root causes, found and fixed by an Opus review: (1) the bare 2-word phrase `"Operations Manager"` in the matching pool exact-substring-matched *any* `"<anything> Operations Manager"` title, so the qualifying domain was unconstrained; (2) a 70%-word-overlap fallback counted the stopword "and", letting "Recruiting Operations **and** Programs Manager" match "Strategy **and** Operations Manager"; (3) the bidirectional `matchLiveJob` check added earlier that same day had a real bug — a title in a non-Latin script normalizes to an empty string in `freshness-check.ts`'s `normalizePhrase`, and the old `if (!normalizedTitle) return true` early-return turned that into a wildcard that matched every target phrase at once. **Fixes**: `textMentionsTitle` now distinguishes "genuinely empty title" (still trivially true) from "non-empty title that normalizes to nothing" (now `false`) — see the new `isComparableTitle()` export, with the two other fail-open callers (`isLikelyClosed`, `scoreJobUrl`) explicitly guarded so they don't misread "can't verify" as "role is gone." `known-company-boards.ts`'s matcher was replaced entirely — `classifyRoleFamily()` is a structural test (must name an ops/strategy function AND a domain that's actually his, must NOT name a disqualifying specialization like Recruiting/HR/Warehouse/IT/Clinical/Billing ops) instead of fuzzy text overlap, plus a location check (`isLikelyNonUsLocation`) using US/non-US place-name marker lists. Scoring (`scoreLiveBoardMatch`) went from a flat-bucket heuristic that produced a near-constant 55 to a tiered deterministic score (60–88 spread) — deliberately kept deterministic rather than routed through a second Claude call, since this channel only ever has a bare title to score (no description/salary/location context an LLM could reason over) and free-ness is the whole point of the channel. The main Claude-scored rubric in `job-search-agent.ts` got a matching tightening after an audit of all 172 historically-scored suggestions found the same blind spot in the procurement/sourcing family (3 real candidate dismissals: OpenAI "Strategic Sourcing Manager, Compute", Google "GPU Commodity Manager...", Lambda "Procurement & Operations Lead" — all scored 74-82) — the old rubric's "higher for" clause literally rewarded "vendor ops," which has been removed. 22 of the 65 validation-run suggestions were confirmed false positives under the new logic and dismissed; 2 borderline judgment calls (Anthropic "Data Operations Manager, Human Data", Scale AI "TPM, Gen AI Operations Planning") were left to the candidate — both kept.
  - **Perplexity vs. Exa vs. Gemini, evaluated 2026-07-27**: staying on Perplexity was the right call — every yield failure traced back to query construction, not the vendor (the same API found 157 good candidates once queried properly). Gemini's web-grounding tool was ruled out entirely (opaque redirect URLs instead of real links, no domain/date filter — wrong shape for a pipeline that needs verifiable deep links). Exa has one genuine edge (`excludeDomains`, vs. Perplexity's include-only `search_domain_filter`) but it mostly stops mattering once every query is ATS-domain-filtered anyway, which it now is; revisit only if adjacency/recall becomes the bottleneck again after the above fixes are given time to work. **That condition was met and the revisit happened on 2026-09-10 — see "Exa vs Perplexity, measured" below. The headline conclusion changed: the two engines are complementary, not substitutes.**
- `src/lib/search/specificity-check.ts`: rejects generic "careers page" URLs unless they carry a `gh_jid`/`ashby_jid` query param, or the URL is a bare ATS board root (see above).

## Candidate facts & default answers (also in Claude Code memory, but here for redundancy)

Gaurav Patanker — Fremont, CA (94538). Background: Business Operations / Strategy & Ops / GTM Ops / BizOps, AI infrastructure focus. AWS (Sales/Biz Ops) → Lambda Labs (Cloud Ops Analyst, Special Projects — fraud/risk) → Together AI (Business Operations Analyst, Infrastructure & Strategy). M.S. Business Analytics (Georgetown), B.S. Managerial Economics (UC Davis). 8 years self-reported total experience (resume itself only spans ~3+ years since it's tailored, not a full history).

Full detailed background, story bank, and pre-written answers to common interview-style prompts live in the DB (`storyBankEntries`, `questionBankEntries`) — query them directly rather than re-deriving from memory if you need to draft an essay answer. As of this writing they cover: greatest achievement, why-this-company, technical background, hardest project, negotiation examples, "something not on your resume" (first-gen American, national cricket team), etc.

**Standing default answers for recurring application questions and per-ATS Playwright gotchas (Greenhouse/Ashby/Rippling/embedded forms) live in the `apply-run` project skill** (`.claude/skills/apply-run/SKILL.md`) — it auto-loads whenever a session is about to drive a live apply run, rather than depending on this file being read first. Update the skill (not this file) when you learn a new gotcha or default.

**Closing out a job now goes through the real API, not raw SQL** (changed 2026-07-22): `PATCH /api/agent-runs/{runId}` with `{status: "completed"}` or `{status: "blocked", resultSummary, blockReason, requiredManualInput?}`, driven through the authenticated browser session's own cookies via `browser_run_code_unsafe` — see the skill for the exact snippet. This single PATCH cascades `jobs.status`/`appliedAt`/`blockReason` automatically via `computeJobStatusSideEffects()`. It does **not** cascade `jobs.approvalStatus` — see the gotcha above, that still needs a periodic manual sweep.

## Efficiency/cost KPIs (shipped 2026-07-22, verified accurate 2026-07-24)

The Overview page (`src/app/(dashboard)/page.tsx`) has an "Automation efficiency" section: est. API cost, cost per applied job, avg time to submit, manual time saved (est.), manual intervention rate, question-bank reuse rate — plus a block-reason breakdown and a time-in-stage median table. Backed by `llmUsageLog` (instrumented at every Anthropic/Perplexity call site via `src/lib/observability/llm-usage.ts`'s `logLlmUsage`/`logAnthropicUsage`) and the new `agentRunQueue.requiredManualInput` / `jobs.appliedAt` / `jobs.blockReason` / `questionBankEntries.hitCount` columns.

Spot-checked against raw DB queries on 2026-07-24 — the math is correct. Two numbers currently read as "low" but aren't bugs:
- **Question-bank reuse rate shows 0%** — not because matching is broken, but because `applicationQuestions.answer` is barely populated (1 row total as of this writing). Almost all essay/short-answer questions get written live in-browser during a Claude Code apply-run session, bypassing the app's own generate-answer/question-bank UI entirely. The KPI is measuring real in-app usage, and real in-app usage of that particular flow is just rare in practice.
- **Time-in-stage medians all show 0.0d** — tailoring, prompt-scanning, and applying almost always happen within the same sitting (same apply-run session), so the day-granularity median rounds to zero. Accurate, just not a very informative number given how this pipeline is actually operated (batch sessions, not a multi-day human queue).

## First-round interview tracking (added 2026-07-24)

`jobs.firstRoundInterviewAt` (nullable timestamp) + two Overview page tiles ("First-round interviews" count, "Interview rate" = count ÷ applied). **There is no automated email integration** — this column is only ever set by manually sweeping Gmail (via the Gmail MCP tools available in a Claude Code session) and cross-referencing hits against the `jobs` table by company name, then writing confirmed matches with a throwaway script. Re-run the sweep periodically by searching Gmail for interview/screening keywords (`subject:interview`, `"phone screen"`, `"recruiter screen"`, `"would love to connect"`, etc.) scoped to `after:` the earliest job's `createdAt`, and only persist matches you're actually confident about — a lot of what turns up (SpaceX, Supermicro, Nominal, Bolt Graphics as of this writing) is real interview activity from applications made *outside* this app and should stay out of this count. Use the email's own outreach date as the timestamp, not the scheduled meeting time (meetings reschedule; the outreach date doesn't).

## Pipeline Analyst (added 2026-07-24)

A fourth agent — Claude Opus 4.8, not Sonnet — that reviews the entire job history and writes a short, data-grounded analysis (`/analyst` page, `src/lib/analyst/pipeline-analyst.ts`). Full design rationale in [ARCHITECTURE.md](ARCHITECTURE.md); the operational bits:

- **Triggered by signal, not schedule** (`src/lib/analyst/eligibility.ts`): 1+ new first-round interview, or 10+ new applications, since the last report. `POST /api/analyst/run` checks this itself and no-ops cheaply if nothing qualifies — pass `{ force: true }` to run anyway.
- **Wired into the apply-run flow**: the `apply-run` skill calls this endpoint after every batch closes out, so it naturally runs right after a day's applying/interview-sweep produces new signal, with no separate cron/scheduler needed.
- **New table**: `analyst_reports` — `triggerReason`/`triggerDetail`, `jobsAnalyzedCount`, `model`, `summary`, `recommendations` (jsonb array of `{title, detail, category}`), `estimatedCostUsd`.
- **First real run (2026-07-24, triggered by the Fluidstack + Redwood Materials interviews)** cost $0.14 and correctly flagged that both interviews came from *below-median* match/coverage scores while high-match roles had zero interviews — a genuinely useful, non-obvious finding given the data, though explicitly caveated as too small a sample (2 interviews) to trust yet. Worth re-reading once more interview data accumulates to see if that pattern holds or was noise.
- It never changes prompts, criteria, or resumes itself — recommendations are for a human (or a Claude Code session, on request) to act on.
- **`resumeCoverageScore` was badly miscalibrated until 2026-07-28 — fixed, see the dedicated section below.** The Analyst's first report correctly used this to flag a real (if small-sample) pattern; just know the underlying numbers it was reading are more trustworthy now than they were when that report ran.

## Resume coverage scoring was broken — fixed 2026-07-28

`jobs.resumeCoverageScore` (0-100, shown throughout the app and read by the Pipeline Analyst) was reading chronically low — mostly 15-45, uncorrelated with `matchScore` (measured at -0.18 correlation across 138 jobs, i.e. no relationship). Root-caused and fixed, not a real reflection of resume-job fit:

1. **The dominant bug**: `jobSearchSuggestions` → `jobs` promotion (`src/app/api/search/suggestions/[id]/promote/route.ts`) never captured the actual posting text — only the 1-2 sentence LLM-written `resumeAngle` blurb. 144 of 145 jobs had `jobDescription IS NULL`, so coverage was being scored against marketing prose ("near-perfect fit," "cross-functional") instead of real requirements. **Fixed**: promote now fetches and stores the real posting text via a new shared helper, `src/lib/search/fetch-posting-text.ts` (extracted from logic `score-job-url.ts` already had for Greenhouse/Ashby/generic pages — no new scraping surface, just reused and shared). `generate-resume/route.ts` also lazily backfills `jobDescription` for older jobs the next time their resume is regenerated, so historical jobs self-heal over time without a bulk backfill.
2. `src/lib/resume/keyword-coverage.ts`'s `scoreCoverage()` silently excluded job title, company, and each bullet's curated `keywords`/`synonyms` fields from what counted as "covered" — a candidate whose real title is "Business Operations Analyst" got zero credit for an "operations" JD keyword. **Fixed**: all of that is now included.
3. Matching was exact-substring-only, so "strategic" (resume) never matched a "strategy" (JD) keyword, and "operational"/"operating" never matched "operations." **Fixed**: added a small, deliberately conservative prefix-based stemming check (`wordsMatch()` in `keyword-coverage.ts`) — two words match if they share the same first 5 characters and are both 6+ characters long. Not a real stemmer/NLP dependency, just enough to close the specific gap that was measured live.
4. `src/lib/text/keywords.ts`'s stopword list was too small for short job descriptions — generic filler words ("bring," "same," "provide," "clear") were crowding out real requirement terms in the top-40 extracted keywords. Expanded.

**Verified against real data before committing**: re-scored the one job that already had a real `jobDescription` (Sierra, GTM Ops Analyst) — 28 → 48. Re-fetched real live postings for 4 other high-match jobs that had `jobDescription IS NULL` and re-scored those too — moved from a stale 30-42 range to 48-55, with real variation between roles (not a flat inflation) confirming this is a better *measurement*, not just a higher number.

`COVERAGE_RETRY_THRESHOLD = 55` in `src/lib/resume/tailoring-agent.ts` was deliberately left as-is — not enough live post-fix data yet to confidently pick a new number. Revisit once more jobs have gone through resume generation under the fixed scoring. No bulk backfill was run against the ~144 historical jobs missing `jobDescription` (that would mean real LLM tailoring calls + regenerating already-submitted resumes for jobs already applied to) — they'll backfill naturally via `generate-resume`'s lazy fetch whenever/if a resume is regenerated for them.

## Search role-family precision — second pass, 2026-07-28 (finance/marketing/sales-IC/engineering/Principal)

A fresh 85-suggestion batch from the direct-board-poll channel (`known-company-boards.ts`) surfaced ~18 real false positives the candidate individually flagged while reviewing the queue: Corporate Development/M&A ("Corporate Development Operation & M&A Integration Lead", Snowflake — "corporate" is a `CORE_DOMAINS` word and "operation" trips `OPS_HEAD`, so it passed despite the candidate having zero M&A experience), Principal-level titles (confirmed too senior — contradicted a stale prompt line that called Principal "fair game"; `OVER_SENIOR_TITLE_REGEX` now includes it, which fixes both the LLM-scored channel and the free board-poll channel since the latter imports and reuses the same regex), quota-carrying/customer-facing sales IC roles (Account Executive, Account Manager, Sales Manager, SDR/BDR — these passed because `classifyRoleFamily()`'s non-ops `hasStrategy` branch let ANY `ADJACENT_DOMAINS` word (sales, customer success) qualify a title purely because "Strategic" appeared as an adjective on an unrelated noun like an account tier, e.g. "Sales Manager, Strategic Accounts"), and hands-on engineering/technical IC roles (any "...Engineer" title, plus "Network Operator" — these routinely also named "Operations" plus an adjacent domain like infrastructure/data-center, so the structural test alone let them through).

Fixed in both `known-company-boards.ts`'s `classifyRoleFamily()`/`DISQUALIFYING_DOMAINS` (the free heuristic channel) and `job-search-agent.ts`'s LLM system prompt (mirrored for consistency across both discovery channels) — see git log for the exact diff. Deliberately scoped narrow in two places after review: the engineering exclusion is "engineer(s)" only, not the broader "engineering" (so "Engineering Strategy & Operations Manager" — a legitimate BizOps-for-the-eng-org title — stays in scope, since only bare "...Engineer" IC titles were ever evidenced as unwanted); and the "Strategic Partnerships"/"Strategic Customer Success Manager" sub-pattern (Mercury, Flex, Ōura, Notion, Plaid, Snowflake Alliance, Ashby, SentiLink, Watershed, Retell AI — 12 titles) was caught by the same classifier fix but wasn't individually named by the candidate; asked directly, he said restore all 12 to the queue rather than treat that sweep as settled — they're back in `job_search_suggestions` as `status='new'`, the code still classifies future postings of this shape as non-qualifying (SpaceX's "International Infrastructure Operations Specialist (Starlink)" was separately dismissed, but only because of a concurrent SpaceX interview — see Claude Code memory — not because the role itself is out of scope).

## The live-board matcher was rewriting URLs to the wrong job — fixed 2026-09-12

**Symptom:** a search run added only 1-2 suggestions and looked like the market was exhausted. It wasn't. `found: 373, skipped: 363, added: 1` — and independently, 55 of the board-poll's 345 candidates were genuinely not in the DB. The gap was a real bug, not saturation.

**Root cause:** `matchLiveJob` in `live-board.ts` returned the **first** board posting whose title passed `textMentionsTitle` in either direction. That helper falls back to **>=70% word overlap** for titles of 3+ words — a rule written for matching a title against a whole *page*, where it's reasonable, but far too loose for title-against-title. On boards with many near-identical titles (DoorDash had ~26 distinct "Strategy & Operations" roles, Verkada and Notion similar) every candidate matched whichever similar title was listed first, and `resolveCandidateFreshness` then **rewrote the candidate's applyUrl to that other job's URL**.

Two distinct harms, and the second is worse:
1. The rewritten URL usually collided with an already-known URL, so genuinely new postings were silently counted as duplicates (`skipped`) and never inserted. Hence "only two jobs populating."
2. Anything that *did* get through was stored with **one job's title and a different job's apply link.** This is the actual cause of the title/URL mismatches hit during the 2026-09-10 apply run — OpenAI's "Partnerships Operations Lead" whose link opened "Government Partnerships Communications Lead", and Faire's "Strategy & Operations Lead" whose link opened the London "International" role. Those were logged at the time as bad search metadata; they were this bug.

**Fix (two parts):**
- `resolve-freshness.ts`: if the candidate's own `applyUrl` is itself a currently-open posting on that board (new exported `sameBoardUrl`, host+path comparison so `?gh_jid=`/`?utm_source=` don't matter), return it **untouched** with `recovered: false`. The board-poll channel's URLs come straight off the board and never needed recovering at all.
- `live-board.ts`: `matchLiveJob` now prefers an exact normalized-title match, otherwise scores every loose match by symmetric word overlap and takes the **best** rather than the first, and returns `null` when the top score is tied (ambiguous is not licence to guess). The 2026-07-28 bidirectional behaviour is preserved — a reworded title like "Senior GTM Strategy & Operations Manager, Enterprise" still matches the board's "GTM Strategy & Ops Manager", and there's a test pinning that.

**Measured before/after on the same DB state:**

| | before | after |
|---|---|---|
| added | 1 | **31** |
| skipped as known | 363 | 305 |
| `recovered` (URL rewrites) | 159 | **4** |
| filteredDiversityCap | 0 | 22 |

`recovered` falling from 159 to 4 is the tell — ~155 of those "recoveries" were spurious rewrites. The diversity cap now actually fires (DoorDash correctly capped at 4/run) because real candidates finally reach it.

**Watch for:** any suggestion whose stored title doesn't match what its apply link opens is this bug's fingerprint. Rows created before 2026-09-12 may still carry mismatched title/URL pairs — verify the live posting before promoting an older row, which the apply-run skill already tells you to do.

## Exa vs Perplexity, measured (2026-09-10) — they are complementary, not substitutes

The 2026-07-27 desk evaluation picked Perplexity and deferred Exa. On 2026-09-10 that was re-run as an actual A/B, prompted by the search queue drying up (a production run found 376 candidates, 96% already known). **The result overturned the assumption behind both the original choice and the swap that was being considered.**

Code: `src/lib/search/exa-discover.ts` (drop-in counterpart to `discoverCandidatePostings`, same signature/return type) and `scripts/compare-search-providers.mts` (the harness). `EXA_API_KEY` is in `.env.local`/`.env.example`. **The live pipeline still runs on Perplexity — nothing was switched.**

**Result (batch 2, the clean run; 11 identical queries per arm, scored against one frozen 201-company snapshot):**

| Arm | Returned | Usable | Usable rate | New co. | Cost | Wall |
|---|---|---|---|---|---|---|
| Perplexity | 184 | 150 | 81.5% | 79 | $0.055 | 0.8s |
| Exa (parity) | 152 | 141 | 92.8% | 75 | $0.153 | 3.3s |
| Exa (tuned, `excludeDomains`) | 162 | 153 | 94.4% | 80 | $0.165 | 3.0s |

- **The engines barely overlap.** Given byte-identical queries and the same domain filter, Jaccard on usable URLs was **0.08–0.11**. Of 137 previously-unseen companies, only 22 were found by both. **Running both would yield +73% new companies vs Perplexity alone, for +$0.17/run** — the original "swap Perplexity for Exa" framing was the wrong question. **But see the correction below: the recommendation is now "don't add Exa yet."**
- **Exa is meaningfully more precise**: ~94% of returned URLs were usable live deep links vs Perplexity's ~82%, reproducible across both batches. Perplexity returns more raw volume with more waste.
- **Perplexity churns, Exa repeats**: run-to-run Jaccard 0.74 vs 0.89 over ~25 minutes. Perplexity's instability is a cheap source of fresh coverage on a daily rerun; Exa's determinism means new coverage must come from new queries.
- **Cost**: Perplexity $5/1k flat regardless of result count (so `MAX_RESULTS_PER_QUERY = 20` is free); Exa $7/1k for ≤10 results **plus $1/1k for additional results**, i.e. ~$0.017/request at 20 results. Per new company: $0.0007 (Perplexity) vs $0.0021 (Exa) vs $0.0016 (both).
- **Exa rate-limits at 10 req/s** and returns `429 RATE_LIMIT_EXCEEDED`; a naive `Promise.all` over the 11-query set trips it and silently loses a query. `exa-discover.ts` caps concurrency at 5. Perplexity has no comparable limit at this volume.
- **Exa returns `costDollars` per response**, so its cost figures here are actual, not modelled. Perplexity's are inferred from the rate card.

**Two harness bugs found in batch 1, both fixed before batch 2 — don't reintroduce them:** the ATS board slug (`andurilindustries`) was being compared against DB display names (`Anduril Industries`), marking nearly everything "new"; and the Exa arms silently ran 10 of 11 queries. **Methodology that must be preserved if this is re-run:** both arms share `buildDiscoveryQueries()` verbatim, and *nothing is persisted* — the production route excludes already-seen pairs forever, so if one arm wrote its finds first the other would be scored against a DB the first had already claimed.

**Caveat on "new companies":** it means an ATS slug not matching any known company after normalization; it does **not** check role scope, so off-target companies are counted. It's a relative measure between arms, not an absolute discovery count.

**CORRECTION (2026-09-13) — the recommendation changed to "don't add Exa yet", for two reasons:**

1. **The premise was a bug, not a real limit.** The case for a second engine rested on "discovery is exhausted — 376 candidates, 96% already known." That 96% was substantially the live-board URL-rewrite bug manufacturing false duplicates (see the section directly above). With it fixed, Perplexity + the free board poll alone went from 1 new suggestion per run to **31**. Adding a paid second vendor to solve a problem that was mostly a bug would have been the wrong call. Re-evaluate only if the queue genuinely dries up again.
2. **The harness's "live-verified" metric was looser than described.** `compare-search-providers.mts` calls `resolveCandidateFreshness` with `title: ""`, and an empty title trivially passes `textMentionsTitle` — so under the old matcher it matched the first job on the board and returned ok for essentially any URL whose company board responded. It measured "is this an ATS deep link on a live board", **not** "is this posting still open". **Fix this before re-running**: thread the real per-result title through (Exa returns `title`; Perplexity returns `title`), since post-fix `matchLiveJob` now returns null on an empty title (all scores tie at 0), which would make the harness report ~0 usable for every arm.

What survives unchanged: the near-zero overlap between the engines (Jaccard 0.08–0.11 — measured on returned URLs, same filter both arms), the cost figures, the 10 req/s rate-limit finding, and run-to-run stability. The precision finding is directionally intact but measures link/host quality rather than posting liveness.

Full write-up (built for an Exa interview on 2026-09-14): https://claude.ai/code/artifact/16472bf6-2f8f-4e76-9c29-b1d99824d42d

## Search scope narrowed: GTM / revenue-motion is out, Sales Ops is IN (2026-09-13)

The candidate stated he has no go-to-market experience and does not want GTM-focused roles. The data agrees: **42 of 240 applications were GTM-flavoured and produced 2 of 9 first-round interviews**, and both of those ("Associate, Business & Revenue Operations, Air Defense" at Anduril, "Commercial Operations Manager" at Redwood Materials) are BizOps titles that merely contain "revenue"/"commercial" — not sales-motion roles. Every other interview is a pure operations title.

**Out:** GTM Strategy & Operations, Revenue Operations / RevOps, Revenue Strategy & Operations, Growth Strategy & Operations, Customer Experience Strategy & Operations, and anything centred on quota / pipeline / top-of-funnel / demand generation.

**Sales Operations is IN** — corrected by the candidate the same day after an initial answer that excluded it. "Sales Operations", "Sales Strategy & Operations" and plain "Strategy & Operations" are all in scope; his AWS role was Business Operations Analyst on the Public Sector **Partners** team, so sales-adjacent ops is his actual background. The word "sales" is therefore deliberately absent from `GTM_SALES_DOMAINS` — don't re-add it.

**Explicitly still in — do not over-apply the rule:** a title that is explicitly *Business* Operations even when it also names revenue (the Anduril shape); *Commercial* Operations (the Redwood shape); *Product* Operations (PermitFlow — interviewed); and all Business Ops / Strategy & Ops / Infrastructure & Data-Center Ops / Capacity Ops targets.

Implemented in three places, all of which must stay in step:
- `known-company-boards.ts` — new exported `isSalesSideGtmTitle()` (GTM_SALES_DOMAINS minus a narrow BIZOPS_RESCUE), called from `classifyRoleFamily`. Exported specifically so the same rule can sweep already-queued rows rather than being re-implemented and drifting. **BIZOPS_RESCUE is deliberately narrow ("business operations", "business revenue", "bizops") — widening it to "strategy" readmits the whole excluded family.** Note `normalizeForMatch` collapses punctuation, so "Business & Revenue Operations" must be written "business revenue".
- `job-search-agent.ts` — mirrored as a hard sub-40 rule in the LLM scoring prompt, with the real example titles. The older sales-IC rule's note that "Sales Operations / Revenue Operations remain fully in scope" was amended, since it now contradicts this.
- `candidateProfile.searchCriteria.roleFamilies` — "GTM Operations" and "RevOps" removed (11 -> 9).

Several pre-existing tests used GTM titles as their *on-target* fixtures and had to be re-pointed at BizOps equivalents — that was a deliberate scope change, not a weakening of the rule. 246 tests pass.

**Open question, do not guess at it:** immediately after setting this rule the candidate manually dismissed **36 of 38** queued suggestions, keeping only Ramp "Product Operations Specialist" (54) and Cerebras "Manager - AI Infrastructure Operations" (55). The dismissals include core BizOps at match 88 (Motive x3, Fluidstack), all six DoorDash Strategy & Ops roles, both Harvey Product Ops roles and Verkada's Commercial Ops — i.e. families he had explicitly said to keep minutes earlier. That is either a bulk clear-out of a stale queue or a much narrower scope than stated. **Ask before encoding anything narrower**; inferring a rule from that sweep would gut the search.

## Resume tailoring can now reword bullets (2026-09-16)

The tailoring agent previously could only reorder bullets and swap pre-approved synonyms; it could not change wording. The candidate asked for JD-keyword-driven rewording — "as long as key numbers and the context is not changed... nothing should be fabricated just reworded based on job posting" — **explicitly with no approval step**. Since there is no human gate, the invariants are enforced in code.

**`src/lib/resume/rewrite-guard.ts` is the safety boundary.** `validateRewrite(original, rewrite, approvedVocabulary)` accepts a reword only if:
1. every number is preserved **verbatim, character for character** — "$3M" may not become "$3 million" or "$3,000,000". Reformatting is refused on purpose: once it's allowed, a faithful reformat is indistinguishable from a magnitude slip ("$3M" → "$3B").
2. no new number appears anywhere;
3. every proper noun / acronym survives and none is invented (no new company, tool, system or credential);
4. length stays within 0.55–1.6x.
A failing rewrite is **silently discarded and the original text used** — never an error.

Two refinements found by running it for real, both worth keeping:
- **The rewrite's first word is exempt from the entity check.** It's the action verb and must be free to change. An allowlist of verbs was tried first and immediately failed on "Cut" — that list will never be complete, and every miss silently costs a legitimate rewrite. An acronym in the lead position is still checked.
- **A bullet's own pre-approved synonyms count as supported vocabulary** (`approvedVocabulary`, passed from `applyTailoring`). Without this the guard rejected "go-to-market efforts" → "GTM efforts" even though "GTM efforts" is literally in that bullet's synonym list.

Wiring: `TailoringPlan.bulletRewrites` (bulletId → text); `applyTailoring` prefers a *valid* rewrite, else falls back to synonym swaps (a reworded bullet no longer contains the synonym keys, so the two are mutually exclusive per bullet); the agent's tool schema and system prompt carry the constraints, and the user message now includes `missingKeywords()` so the model is handed the exact keyword gap instead of inferring it.

**The prompt had to be made directive.** A first pass worded cautiously ("reword only when...") produced **zero** rewrites — the model declined to use the capability at all. Telling it to expect to reword roughly half the bullets, and that the constraints are verified in code afterwards, took it to 13 proposed / 13 accepted. If rewrites ever drop to zero again, suspect prompt caution before suspecting the plumbing.

Measured on the Google posting: coverage **60 → 65**, 13 of 13 rewrites accepted, and an independent audit confirmed every number in the rendered resume is identical to the master. **The master resume is never written to** — rewording is per job, which is the thing that was explicitly reverted on this same day when a tailoring pass had edited the master instead.

Docs updated to match (README, ARCHITECTURE) — both previously stated the agent "can never invent new resume content" by construction. The guarantee is now enforced by verification rather than by construction, which is a real change in kind and is described as such.

## The tailored resume must stay one page — enforced 2026-09-16

**Bullet rewording silently produced a 2-page resume on its very first real run.** Total bullet text grew by **1%** and that was enough: the master resume is deliberately tuned to fill exactly one page with almost no slack, and pdfkit adds an overflow page without complaint. Nothing in the pipeline was checking, so a 2-page PDF was uploaded and attached to the job.

`src/lib/resume/fit-one-page.ts` now guarantees it, wired into `generate-resume/route.ts`:
- `countPdfPages()` counts `/Type /Page` objects (excluding the `/Pages` tree node) — the fit is verified against the **actually rendered PDF**, never estimated from character counts.
- `fitPlanToOnePage()` re-renders in a loop, giving rewrites back until it fits. Bullet ordering and synonym swaps are never touched — they carry the relevance gains and barely affect length.

Two ordering rules, both learned from real failures rather than guessed:
1. **Sacrifice the oldest role's rewrites first.** A purely greedy largest-delta-first rule stripped all four Together AI rewrites (his current role, the one a recruiter reads first and an ATS weights most) while keeping every AWS 2022-2024 one. Now sorted by section index descending, then delta.
2. **Character delta is only a proxy for height.** An equal-or-shorter rewrite can still wrap to an extra line. The first version only ever dropped length-*increasing* rewrites, so when those ran out it stopped and wrongly reported "the master resume itself is too long for one page" — on a master that renders as one page. Now two-phase: growers first, then any remaining rewrite, and `overflowsWithoutRewrites` is only true once **every** rewrite has been given back.

Coverage is re-scored after fitting, on the resume that actually shipped — the agent's own number is computed before the fit hands rewrites back and would otherwise overstate the PDF being sent.

Verified over three consecutive real runs: 1 page every time, coverage 65/65/68, with 5-12 of 13 rewrites surviving depending on the plan. **If the master resume ever grows, this degrades quietly** — rewrites get dropped to buy space and tailoring silently weakens before anything breaks. The `[generate-resume] ... dropped N rewrite(s)` warning is the early signal; a `... too long for one page` warning means the master itself needs trimming.

## Company research feeds the tailoring agent (2026-09-16)

New table `company_profiles` + `src/lib/company/company-context.ts`. The tailoring agent previously saw a job description and a company name and nothing else, so it couldn't know that Google Cloud's AI2 team is infrastructure-adjacent — the single fact that decides whether to lead with GPU-capacity work or generic BizOps process work.

`getCompanyContext(company)` returns a cached profile — summary, domain tags, and "what this employer likely values in an ops hire" — researching once via **2 Perplexity searches + 1 Sonnet call (~$0.01)** when absent or older than 120 days. **Cached by normalized company name, not per job**: this pipeline sees the same ~200 employers repeatedly (Anduril 25+ times), so per-job research would buy the same answer dozens of times. Measured: 8.2s on a cache miss, **63ms and free** on a hit. Fails soft everywhere — no key, no network, thin results, or bad output all return null and tailoring proceeds exactly as before. The `db` import is lazy (same convention as `llm-usage.ts`) so the pure helpers unit-test without `DATABASE_URL`.

Live output for Google included "large-scale operations and capacity planning across global infrastructure" and "vendor/partner management" — both of which map directly onto real bullets, which is the point.

**The one-page fitter had to be reworked twice more before this was actually usable**, and the order it gives things back matters more than it sounds:

1. **Synonym swaps add length too.** The first fitter only touched rewrites. A real run dropped *every* rewrite, still rendered 2 pages, and reported "the master resume itself is too long" — on a master that renders as one page. Swaps like "Negotiated" → "Drove procurement negotiations for" are 20+ characters longer and were never being reconsidered.
2. **Give back swaps BEFORE rewrites.** Once swaps were included, the naive order still sacrificed rewrites first — stripping every keyword-bearing rewrite while leaving the longer swaps that caused the overflow. A rewrite carries the posting's actual vocabulary (what an ATS scores); a swap is just an alternate phrasing. Current order: things that grew → swaps before rewrites → older roles before the current one → biggest space win.

Result went from `rewritesKept=0` on every run to **0 rewrites dropped, 1 swap given back, 1 page, coverage 60-63** across three consecutive runs.

**Two prompt lessons, both of which cost a tuning cycle:**
- **Cautious wording produces zero rewrites.** Already noted above; adding an anti-keyword-stuffing paragraph re-triggered it and dropped output from 13 proposed to 1-4. If rewrites fall off, suspect prompt caution first.
- **Tell the model the page is full.** The resume is one page with no slack, so any rewrite that adds characters gets discarded by the fitter — wasted work. The prompt now states the rewrite must be no longer than the original and to *substitute* wording rather than append it. Model output moved to deltas of −9, −9, −9, +1, which survive the fit instead of being thrown away.
- Anti-stuffing guidance is still in the prompt and earning its place: an earlier run bolted "at scale" onto two consecutive bullets, exactly the tell a recruiter notices.

## Query rotation is per-run now, not per-day (2026-09-17)

**The agent is run several times a day, and every run after the first was firing byte-identical queries.** Two compounding causes in `perplexity-discover.ts`:

1. `rotateSlice` keyed its offset to `Math.floor(Date.now() / 86_400_000)` — the calendar day. Same day, same slice.
2. The pool held **14 phrases** and a run consumes two slices of 8 (fresh + widen = 16). One run exhausted the entire pool, so there was nothing left to rotate *to* even in principle.

On top of that, the offset advanced by **one position** per step, so consecutive slices shared 7 of their 8 phrases — rotation barely changed the query set even when it did fire.

Net effect: runs 2-4 of a day depended entirely on the search engine returning different answers to the same question. Measured at 25-minute spacing, Perplexity churns ~26% between identical runs and Exa ~11%. That is the real reason **Perplexity suits this usage better than Exa** despite Exa winning decisively on single-run link quality — see the bake-off section above. Uncontrolled vendor churn was doing the job that rotation should have been doing.

**Fixed:**
- `ROTATION_BUCKET_MS = 15 min` replaces the day bucket, with an optional `rotationSeed` param so tests pin it.
- `rotateSlice(pool, count, sliceIndex)` advances by a **whole slice**, not one position.
- A run takes two consecutive slices (`step * 2` and `step * 2 + 1`), so fresh/widen are disjoint within a run *and* the next run starts past both.
- Pool grown **14 → 32 phrases**, weighted toward infrastructure / capacity / data-centre / field ops — the family that has actually produced first-round interviews (Fluidstack, SpaceX, Base Power, WindBorne) and was barely represented before.
- Dropped `GTM Strategy and Operations Manager`, `Revenue Operations Manager`, `Growth Operations Manager` — those families were excluded on 2026-09-13, so the search was paying to fetch results the classifier then rejected. `Sales Operations Manager` and `Sales Strategy and Operations Manager` were kept: Sales Ops is explicitly in scope.

**Measured:** consecutive runs now share **0 of 16** role phrases, with reuse starting only on the third run (the effective pool after merging the profile's own role families is ~41 phrases, giving ~2.5 fully-disjoint runs). Two real back-to-back runs added **15 then 9** net-new suggestions; previously the second would have contributed nothing from the Perplexity channel.

**If more same-day runs are wanted**, the lever is pool depth: four fully-disjoint runs needs ~64 phrases. Don't pad it with near-duplicates — a weak phrase costs a whole query slot.

**Unchanged and worth remembering:** the free `known-company-boards` channel is the one that genuinely surfaces *intra-day* novelty. It polls ~167 live boards directly, so a role posted at 2pm shows up in a 3pm run regardless of query rotation or search vendor.

## Current pipeline state (as of 2026-09-08)

**371 real jobs on file: 231 applied, 138 blocked, 1 archived, 1 discovered (Google, "Associate, Business Operations and Strategy", untriaged since 2026-08-26).** **12 untriaged suggestions** in `job_search_suggestions` (`status='new'`), all from the 2026-09-08 search run below; the other 630 suggestion rows are fully resolved (372 promoted, 258 dismissed). Between the 2026-07-28 snapshot and this one, ~226 jobs were added across batch sessions (biggest single day: 45 on 2026-08-17) — the 40 untriaged suggestions described in the precision-pass section above were worked through weeks ago. See git log and the `jobs` table's `created_at` for the batch history.

**226 jobs currently need the `approvalStatus` sweep** (terminal `status` but `approval_status = 'pending'`) — the structural gap described in the architecture section above. It was 4 jobs at the last snapshot; it grows with every batch and nothing has fixed it at the source yet, so the Overview page's "Pending review"/"Awaiting approval" tiles are currently meaningless. Run the documented `UPDATE` before trusting them.

**Search run of 2026-09-08**: 376 raw candidates (339 of them from the free `known-company-boards.ts` board-poll channel), 355 skipped as already-known, 9 filtered closed, **12 net-new added** — and notably 0 filtered by the per-company diversity cap and 0 by the generic/blocked-source checks. The widen pass fired (as it does whenever a run lands under `TARGET_NEW_SUGGESTIONS = 20`). A ~96% already-known rate is the expected steady state now that ~370 jobs and ~630 suggestions are on file: the binding constraint has moved from precision (the 2026-07-28 problem) to market exhaustion within the known-company set. If future runs keep landing in the single digits, the lever is new companies in the discovery pool, not more query rotation.

**Running a search headlessly**: every `/api/*` route is gated by `src/proxy.ts` → `updateSession()`, which 401s unauthenticated API calls, so `curl` against a local dev server won't work without a Supabase session cookie. The proxy only runs on real HTTP requests, so the simplest path from a Claude Code session is to import and call the route handler directly — write a `.mts` file (top-level `await` fails under tsx's default cjs transform for a plain `.ts`) that does `import { POST } from "@/app/api/search/run/route"`, then run `node --env-file=.env.local ./node_modules/.bin/tsx <file>.mts` from the project root so the `@/` tsconfig path alias resolves. Takes ~2 minutes end-to-end. Ad-hoc DB queries work the same way with the `postgres` package directly, as `scripts/*.mjs` already do.

**New pattern from recent batches, worth keeping**: always freshness-check *and sanity-check the actual role* (location, comp, eligibility) before promoting a `jobSearchSuggestions` row — the search agent can return a title/company match that's real and live but still a bad fit (e.g. a "Business Operations Manager" suggestion that turned out to be Remote-UK-only for a US-based candidate). Match score alone doesn't catch this; read the live posting.

**New ATS encountered**: Rippling's own hosted ATS — see the `apply-run` skill for the details (Cloudflare challenge, autofilled Location field needing correction, how to confirm submission success).

## Apply-run batch, 2026-09-10 (14 jobs) — what the ATSes did

First batch driven end-to-end from a search-queue triage. **9 submitted, 5 blocked.** Submitted: Watney, Serval, Vanta, Anthropic, Baseten, Faire (RevOps), Pallet, Medra, Hostie. The 5 blocks are the useful part:

- **Three of the five blocks were bad search metadata, not ATS problems** — the live posting did not match what `job_search_suggestions` recorded. Faire "Strategy & Operations Lead" (recorded NYC/SF, $158-219k) is really **"International Strategy and Operations Lead," London UK**. OpenAI "Partnerships Operations Lead, OAI for Government" is really **"Government Partnerships Communications Lead," Department: Communications** — a comms role, out of scope. Turing "Strategy & Operations Manager" had closed between the search run and the apply run. This is the HANDOFF "sanity-check the actual role before promoting" rule earning its keep three times in one batch; **read the live posting's own `h1` and location line before filling anything**, and expect the board-poll channel (title-only data) to be the offender.
- **OpenAI enforces a hard application cap**: submitting returns "we have set up limits for applications across roles. Candidates may not apply more than 5 times in any 180 day span." The cap is already exhausted, so **every OpenAI role is unapplicable until the window rolls over** — don't queue more, and treat the scorer's existing "OpenAI is overrepresented" penalty as a hard stop rather than a score nudge. Same shape as the documented Fluidstack limit.
- **Greenhouse can serve a degraded, unsubmittable page to automation.** On Gusto, the `intl-tel-input` phone/country widget rendered 0x0 so Country never registered, and after every field validated clean the submit button went disabled and hung with no confirmation. The tell is in the network log: `POST boards.greenhouse.io/{org}/jobs/{id}` returning **HTTP 428 Precondition Required** (anti-bot precondition). A clean reload did not fix it. Check for 428 before assuming a filling bug and burning a second pass.
- **Lever (`jobs.lever.co`) is effectively closed to automation**: submit is gated behind hCaptcha (hidden `#hcaptchaSubmitBtn`, repeated `api.hcaptcha.com/getcaptcha` POSTs) plus a Cloudflare challenge. Everything else on the form works — fill it completely, then hand it to a human to solve the captcha and click submit.

Other mechanics worth keeping:

- **The Ashby email React-desync is common, not rare** — it hit on the first form of the batch. Cheap prophylactic: always type Email with real keystrokes (`pressSequentially`) rather than `fill()` on Ashby. When a "form needs corrections" banner names a field, apply the documented clear -> verify-empty -> retype fix; do not retype over a `fill()`ed value.
- **Never set a React-controlled input with a programmatic value setter.** Doing that to an Ashby field produced a value that was visible in the DOM, survived verification, and was still reported empty at submit.
- **Greenhouse react-select: match the option exactly, don't type-and-Enter.** Typing "Male" filtered to **"Female"** (substring match) and silently selected the wrong EEO answer on Gusto. Enumerate the listbox (`aria-controls` -> `[role=option]`) and click the option whose text matches exactly. Also scope that query to the field's own listbox — a hidden `intl-tel-input` country list (`.iti__country`) pollutes any global `[role=option]` selector.
- **Ashby "When can you start a new role?" is a `react-datepicker`, not a text field** (placeholder "Pick date..."). Free text never sticks; type a date like `10/12/2026` and click the highlighted day.
- **Answering Hispanic/Latino = No reveals a separate required Race dropdown** (seen on Anthropic) — re-scan for new required fields after each answer rather than trusting the initial field list.
- Rippling's autofilled **Location** defaulted to the job's location (San Francisco) instead of the candidate's, exactly as documented — correct it to Fremont, CA every time.

**Answers that had to be invented and should be confirmed with the candidate**: a required start-date/timeline field (answered "flexible, no hard deadlines" on Baseten; 2026-10-12 on OpenAI) and OpenAI's **Applicant Arbitration Agreement** acknowledgement, which is mandatory to submit. **GPA (3.5)** was supplied by the candidate mid-run for Lever/Hive and is not in any seed file — consider adding it to `profile.seed.json`, since it is a required field on some forms.

**A pipeline gap this batch exposed**: `PATCH /api/agent-runs/{id}` (`updateAgentRunSchema`) accepts no `submitAuthorized` field, and `candidateProfile.requiresSponsorship` is still stuck `true`, so every generated brief said "DO NOT SUBMIT" even though submission was authorized. **Partly resolved 2026-09-17**: `createAgentRunSchema` *does* accept `submitAuthorized`, so the flag can be set at run-creation time via `POST /api/agent-runs` — no raw SQL needed. It still cannot be changed after the fact, so a run queued from the UI without it stays wrong; adding it to `updateAgentRunSchema` is still worth doing, as is fixing the stale `requiresSponsorship` flag.


## Apply-run batch, 2026-09-17 (14 jobs) — second end-to-end batch

**11 submitted, 1 blocked, 2 dismissed pre-flight.** Submitted: Headway (Payer Partnerships Lead), Notion, Fieldguide, Mach9, DoorDash, Splice, Conversion, Cogent Security, FurtherAI, Headway (Business Operations Manager), Ramp, Giga Energy. Every tailored resume rendered at one page, so `fit-one-page.ts` held across a full batch.

- **Samsara blocked on geography, not the ATS**: the form states the role is open to US candidates *except* California (among others), and the candidate is in Fremont, CA. Marked blocked rather than submitted. This is a new failure mode — an eligibility constraint stated only on the application form, not in the posting metadata the search agent captured.
- **Cerebras "Manager – AI Infrastructure Operations" was already dead**, and the app caught it: `POST /api/agent-runs` returned **HTTP 422** with "the posting appears to be closed or no longer available" before any browser work. The Greenhouse URL did in fact 404 on manual check. That precondition check is trustworthy — verify once, then `PATCH /api/jobs/{id}` to `blocked` / `posting_removed` and move on.
- **Zero title/URL mismatches this batch**, against 3 of 14 last time. That is the `matchLiveJob` fix (2026-09-12) showing up in outcomes rather than just in the `added` count.
- **Two GTM-department roles still reached the queue** — FurtherAI's "Strategy & Operations Associate" and Headway's "Payer Partnerships Lead" both sit in a GTM/partnerships org despite non-GTM titles. The 2026-09-13 scope rules filter on *title*, and a department line that only appears on the live posting can't be caught that way. Both were on the user's approved list and were submitted with the mismatch flagged. If this recurs, the fix is a live-posting department check at promote time, not more title keywords.
- **Ramp asked four custom essays** (product-ops experience, data→product improvement, working with engineering, an AI tool that changed how you work). All four were written from `storyBankEntries` + `questionBankEntries` rather than improvised — the scrape had not surfaced them, which is the documented "clean scrape isn't proof" trap again.

New ATS mechanics (details in the `apply-run` skill): Ashby Yes/No questions are `button[data-option]` with `aria-pressed`, **not** radios, and their hidden checkbox has no `label[for]`; Ashby's other option groups *do* have `label[for=...]`, which is the reliable way to read exact option text and the safest thing to click. Greenhouse can withhold required Phone/Country fields from the DOM until a first submit attempt fails — the first failure is expected, not a bug.


## Apply-run batch, 2026-09-21 (6 suggestions) — small queue, two new failure modes

Queue was 6 `job_search_suggestions`, all created that morning. **4 submitted, 1 blocked, 1 dismissed.** Submitted: Valence (Strategy & Ops Associate), Pure Storage/Everpure (Sr Sales Ops Manager, Federal), Ambience Healthcare (Business Operations Lead), Fin/Intercom (Sr Sales Operations Manager). All four tailored resumes rendered at one page.

- **Cloudflare "Developer GTM Strategy Manager" dismissed** — GTM in the title, out of scope since 2026-09-13. Worth noting it reached the queue at all with `match=74`: the title contains the literal token "GTM" that `GTM_SALES_DOMAINS` already lists, so this suggestion came through a path that doesn't run `isSalesSideGtmTitle`. Worth tracing if GTM titles keep appearing.
- **Cohere blocked by a reapplication cooldown, discovered only at submit.** The Ashby form accepted a fully filled application and then replaced it with "Our records show you were considered for this role in the past ... 1-year waiting period from the original rejection." **No prior Cohere row existed in `jobs`**, so that earlier application was made outside this system — the pipeline cannot dedupe against applications it never saw, and this will recur. Cohere's form also gates hard on 2+ yrs top-tier consulting AND 2+ yrs investment banking; both were answered No truthfully.
- **`submitAuthorized` now works end to end.** All five runs were created via `POST /api/agent-runs` with `submitAuthorized: true` and came back `auth: true`. Separately, `candidateProfile.requiresSponsorship` now reads **`false`** — the long-standing stale flag is fixed, so briefs should stop saying "DO NOT SUBMIT".
- **The analyst has a floor, and that is correct behavior**: `POST /api/analyst/run` returned `ran: false` — "Only 4 new applications and 0 new interviews since the last report — needs 10+ applications or 1+ new interview." Don't force it on a small batch.

**A resume/profile contradiction surfaced and needs resolving.** `candidateProfile.totalYearsExperience` says **8**, but `resumeProfile.data.experience` totals roughly **3.6 years worked** — AWS Mar 2022–May 2024, Lambda Jun 2024–Mar 2025, Together AI Feb 2026–present, with a Mar 2025–Feb 2026 gap. Ambience gates on "4 or more years in consulting/BizOps/strategy" and Fin's posting asks for 5+ years in Sales/Revenue Ops, so this is not academic — it changes answers on real screening questions. The candidate was asked directly and chose **Yes (4+)** for Ambience, No for the optional "5+ yrs hyperscaling Tech/SaaS". Either the resume is missing earlier roles or the profile number is wrong; resolve it once rather than per-application.

**Daily sweep**: Exa progressed — intro call Thu 2026-09-17, then a next-round invite (30 min with their GTM team) scheduled Tue 2026-09-22. `firstRoundInterviewAt` was already set to 2026-09-10, and the schema tracks only the first round, so nothing was written. Andromeda Cluster interviewed Fri 2026-09-18 but came via an external recruiter and stays out of `jobs`, as before.

New ATS mechanics went to the `apply-run` skill: a Greenhouse field that scans as `INPUT:text` can still be a react-select (Fin's "Current Location" is a region list, and typing a country returns zero options — open it empty); Greenhouse checkbox ids contain `[]` and need a label click; and the Ashby email desync can survive `pressSequentially`, still needing the full clear/verify/retype cycle.


## Single-job run, 2026-09-22 (Watershed) + the first return from the Sept batches

**Watershed "Customer success operations" submitted** (Ashby, NYC on-site, $154,160-$183,300, resume coverage 57 — the highest of any recent tailor). Applied at the candidate's explicit request **despite** the standing GTM/CS-Ops scope exclusion: the live posting's department is literally "Revenue / GTM Operations", and it asks for 5+ yrs GTM Ops (or 4+ hands-on). He has applied to two similar Watershed CS roles before, so this is a deliberate carve-out for this employer, not a scope change. Don't widen the search rules on the strength of it.

**Mach9 came back — interview #10.** `aburke@mach9.io` on 2026-09-22: reviewed the Business Operations Associate application and wants to connect. That application went out on 2026-09-17, so the turnaround was five days. Recorded `firstRoundInterviewAt = 2026-09-22` on job `d073c68b`.

**`updateJobSchema` silently drops `firstRoundInterviewAt`.** `PATCH /api/jobs/{id}` returned **200** and changed nothing — the field isn't in the schema (`createJobSchema.partial()` plus status/approvalStatus/applyAgentStatus/applyReviewConfirmed/blockReason), so zod strips it and the route reports success. Same family as the old `submitAuthorized` gap, and worse because it fails silently rather than erroring. It was written directly with Drizzle instead; that field has no cascade logic, so a direct write is safe here. **Add it to the schema** — the daily sweep needs it on every run.

**Rejections are now arriving in volume, and the schema has nowhere to put them.** Between 2026-09-17 and 2026-09-22: Ramp (Product Ops Specialist | Juno), Fieldguide, Headway (Payer Partnerships Lead), Conversion, Samsara (Product Ops Mgr), Hostie, NVIDIA, Scale AI, Pendo, Capital One, Axial. Four of those are from the 2026-09-17 batch — a ~4-day rejection turnaround. `jobs.status` has a `rejected` value that nothing currently sets, so the pipeline still counts all of these as `applied` and the interview-rate denominator is the only outcome signal being tracked. Worth wiring the daily sweep to set `rejected` the same way it sets `firstRoundInterviewAt`.

**Outside the pipeline**: Supermicro has an active process (final round 2026-08-21, recruiter following up 2026-09-21) with no row in `jobs` — applied outside this system. Google sent a referral invitation from Bhavesh Jain on 2026-09-21 ("apply to up to 3 jobs in 30 days") and acknowledged an application the same day.


## Apply-run batch, 2026-09-23/24 (7 suggestions) — 5 submitted, 1 blocked, 1 dismissed

Submitted: Augment (Business Operations & Strategy Manager), Oklo (Deployment Project Manager), Oklo (Technical Program Manager, Recycling Division), CodePath (Senior AI Operations Lead), Anduril (Product Operations Specialist, Air Defense C2). All five resumes one page. Coverage ranged 23-55 — CodePath lowest, because the employer is education/nonprofit rather than infrastructure.

- **Pallet "GTM Strategy: Products and Markets" dismissed** — GTM in the title, same rule as the 2026-09-21 Cloudflare dismissal.
- **Hive blocked without attempting it.** The suggestion's `applyUrl` was the Lever **board root** (`jobs.lever.co/hive/`) rather than a posting, and both other Hive roles are already blocked. Lever is hCaptcha-gated, so filling the form would produce nothing a human could finish from a Playwright-controlled browser. Resolved the real posting URL (`.../70d6122f-...`), wrote it onto the job row, and marked it `anti_bot_captcha`. **If Gaurav wants Hive, it has to be done by hand.**
- **Anduril's "Product Operations Specialist" is in scope even though "Product Operations Technical Specialist" repeatedly wasn't.** Read the duties before reusing the earlier `out_of_scope_action` judgement: this one is fleet source-of-truth ownership, RMA/RCCA feedback loops, and SOPs across Salesforce/JIRA/Airtable — genuine product ops, not the technician-flavored work those other titles carried.
- **Augment's department is "2. Go To Market"** despite a Business Operations & Strategy title — the third instance of this pattern after FurtherAI and Headway. Title-based scope filtering cannot catch it; only the live posting shows it.

New ATS mechanics (all in the `apply-run` skill): Oklo's Greenhouse board makes **Cover Letter required but hides it behind a generic "Attach" label** — it only surfaces as an error after a failed submit, and the fix is the field's own "Enter manually" button revealing `#cover_letter_text`. Oklo's **export-control question is an A/B/C multiple choice** whose bare letters are meaningless without the long label above it (A = U.S. Person). Anduril's citizenship free-text fields **tell US citizens to answer "N/A"**, but country of birth has no such shortcut.

**Two cover letters were written by hand this batch** (both Oklo reqs). Nothing in the pipeline generates cover letters — the Answer Generation Agent only handles form questions. If cover-letter-required boards become common, that's a real gap.

**Sweep (2026-09-23)**: Mach9 scheduled its first round for Tue 2026-09-29 11am PDT. **Exa advanced to a take-home**, assigned 2026-09-23 and due Sunday 2026-09-27 evening (he negotiated the date himself); the recruiter confirmed the remaining process is take-home -> another interview -> on-site at SF HQ. Outside the pipeline: an **Oracle referral** from Viresh Amin for "Business Operations Program Manager, Data & Automation (IC4)" needs action from Gaurav, and a GLG expert-network invite arrived (not a job).


## Apply-run batch, 2026-09-29/30 (10 suggestions) — 7 submitted, 3 dismissed

Submitted: Curri (Strategy & Ops Mgr, Supply Growth), Coram AI (Sr Strategy & Ops Mgr), Serval (Business Systems Lead), Rula (Sr Business Operations Mgr), Crux AI (Chief of Staff Business Operations), Human Interest (Sales Strategy & Ops Sr Analyst), Anthropic (Strategy & Operations, Office of the CCO). All seven one page; coverage 23-57.

**Three dismissed, and two of the three were bad data rather than bad fit:**
- **Waymo "Business Operations Lead" does not exist.** The suggestion carried a board-**root** URL (`embed/job_board?for=Waymo`). `boards-api.greenhouse.io/v1/boards/waymo/jobs` lists **357** open roles and **zero** matching that title. This is the first confirmed fabricated title in the pipeline, not merely a stale or mismatched one. The board-root URL is the tell — pair it with that JSON API check before promoting.
- **Crux AI "Data Center Operations Program Manager" is really "Data Center Energy Manager"** (Department: Development) — negotiating interconnection, tariffs and supply agreements with utilities and ISOs/RTOs, and owning an energy P&L. A specialist energy-markets role, out of scope, and a different title from what was recorded.
- Crusoe "Revenue Operations Manager, Deal Desk" — RevOps, the standing exclusion.

**Serval is the fourth title/department mismatch in three weeks** (after FurtherAI, Headway, Augment): title "Business Systems Lead", department "Revenue Strategy and Operations". Handled the established way — title in scope, department flagged, applied. Four instances is now a pattern worth fixing at promote time rather than noting each run.

**Two answers that needed judgement, both logged on the runs:**
- **Rula required a legal middle name.** It is in neither `candidateProfile` nor `resumeProfile`. Entered "Manish" on the evidence of "Gaurav Manish" appearing on his own travel-account mail, and flagged for confirmation. **Add the middle name to the profile.**
- **Anthropic requires two acknowledgements**: their AI partnership guidelines for candidates, and a binding **Agreement to Arbitrate** waiving jury trial for application-related disputes. Both mandatory; the candidate should know the second one exists.

Curri gates on a trivia question — the plumber who sparked the founders' idea (**Mike Buck**), answerable from press coverage.

**Sweep (2026-09-29/30) — the pipeline is converting now:**
- **Baseten is interview #11**, previously unrecorded: recruiter outreach 2026-09-16 for Capacity Strategy & Operations. Recorded `firstRoundInterviewAt = 2026-09-16`. The recruiter no-showed the 09-29 call and is rescheduling.
- **Mach9** first round held 2026-09-29.
- **Exa**: take-home submitted 09-28, case-review interview with Isaak booked **Tue 2026-10-06 12:30pm PDT**, then an SF on-site.
- **Base Power on-site Thu 2026-10-01**, 9am-12:30pm PDT at Austin HQ, travel being arranged — a working-session presentation format.
- Outside the pipeline: Palantir (Tomer Solomon, Deployment Strategist) chat pending; Supermicro final round from 08-21 still unresolved after three follow-ups; Oracle referral still needs action.
- Rejections since 09-24: GitLab, Join Parachute, Valence, Cloudflare.

**Analyst re-ran (triggered by the new interview) and hardened its earlier finding**: 11 interviews across 269 applications (~4%), and **8 of 11 came from match<=70**, mostly physical/infrastructure/deployment ops at energy and robotics companies. Its recommendation is now explicit: the match score is *anti-correlated* with interviews, stop deprioritizing sub-70 roles, and actively source more capacity/site/deployment ops work. It also flags chronically low resume coverage (15-45) as a tailoring problem. Still n=11, still directional — but it has survived two independent runs.


## BASE POWER EXTENDED AN OFFER (2026-10-01)

`awilliams@basepowercompany.com`, 2026-10-01: "We're thrilled to extend you an offer to join the Base team," with a Dropbox Sign signature request for "Offer to join Base Power Company." This followed the Austin on-site on 10-01 (working-session format). **This is the pipeline's first offer.**

**The schema cannot represent it.** `JOB_STATUSES` runs discovered -> ... -> applied, blocked, rejected, archived. There is no `offer` state and no offer date column, so the best outcome the system has ever produced is invisible to it — the Base Power row still reads `applied`. Adding an `offer` status (and an `offerAt`) is now the highest-value schema change outstanding, ahead of the `rejected` gap noted below.

## Apply-run batch, 2026-10-02 (17 suggestions) — 10 submitted, 2 blocked, 5 dismissed

Submitted: Indigo ×2 (Business Operations Associate; Business Operations & Strategy Manager), Crux/clean-energy (Business Operations Lead), Rula (Strategy & Ops Manager, In-person), Vannevar Labs (Senior Business Operations Manager), Everpure (Business Operations Manager, Product Tools), Motive (Sales Operations Manager, Implementation), Scale AI (Product Operations Lead, Generative AI), Faire (Strategy & Operations Senior Associate), Ripple (Product Operations, Analyst). All one page; coverage 18-53.

**Five dismissed — three on scope, two on bad metadata:**
- Hello Heart (Senior Manager, **Revenue Operations**), Scale AI (**Revenue Operations** Manager), Planet Labs (Sales Strategy & **GTM** Planning) — standing exclusions.
- **Armada** "Senior Sales Strategy & Operations Manager" is really **"Senior Events Operations Manager"**.
- **Anthropic** "Strategy & Operations, FDE" is really **"GTM Strategy & Operations, FDE"** — the GTM lives in the real title, not the recorded one. That makes four title mismatches caught in two batches; the suggestion titles are unreliable often enough that live verification is now load-bearing, not belt-and-braces.

**Two blocked:**
- **Giga ML (Chief of Staff, $200-220K)** — `eligibility_gate_unresolved`. A required multi-select offers only Consulting / IB / PE / Startup Founder / VC with no "none of the above". None is true, so the form is unanswerable without fabricating. **Note the name collision**: board `gigaml` is a different company from Giga Energy (`gigaenergy`), already applied to — same trap as Crux AI (`crux`) vs Crux clean-energy (`cruxclimate`), both of which also appeared this batch.
- **DualEntry (Chief of Staff, NYC)** — retryable. Ashby's geo-autocomplete died mid-batch (see the skill), leaving a required location field unfillable. Everything else was filled.

**Two answers that were inferred rather than known**, both flagged on their runs: Indigo's required **Interview Recording Consent** (AI notetaker) was answered Yes, and Motive's required **"select your top 3 tangible factors"** was answered Career Growth / Leadership / Company Outlook from the story bank's stated goals. Neither is in the profile; both are worth adding if these recur.

**Rula's second req gates on 5+ years** and was answered No per the candidate's own 2026-09-21 threshold call — honest, but it will almost certainly auto-screen out. He may want to revisit that answer now that it has cost a second application.

**Sweep also found**: Mach9 advanced to a 30-min interview with Alex, **Mon 2026-10-05 12:30pm PDT**. Exa's case review with Isaak is **Tue 2026-10-06 12:30pm PDT** (take-home submitted 09-28). Baseten's rescheduled intro ran **Fri 2026-10-02 5:30pm CDT**. Human Interest rejected the 09-30 application **in one day**. Also rejected since 09-30: GitLab, Join Parachute, Cloudflare, Valence. A "Massed Compute — Business Operations Manager" application confirmation arrived 09-30 that this pipeline did not send — applied outside the system.

## Known bug, not yet filed: the daily-sweep check misfires every evening Pacific

The apply-run skill's "has a run already started today?" gate queries `agent_run_queue WHERE started_at::date = CURRENT_DATE`. The database runs in **UTC**. Any run after ~17:00 Pacific lands on the next UTC day, so the check reports zero runs and would trigger a redundant Gmail sweep. Confirmed 2026-09-08: five closeouts at 18:07–18:13 UTC, and the gate still returned 0. Compare in a fixed local timezone (`(started_at AT TIME ZONE 'America/Los_Angeles')::date`) rather than the session default, or sanity-check the raw timestamps before sweeping twice in one day.

## Auth session expiry and the script fallback (2026-09-03 → 2026-09-08)

The app gates every route behind a single-account Supabase Auth check, and **the Playwright browser's session silently expired around 2026-09-03**. Symptoms: every app API call returns 401 and `/search` redirects to `/login`.

Two things to know:

- **`curl` cannot verify this.** It has its own empty cookie jar and will always return 401. Check through the automation browser's own cookies (`page.context().cookies()` → `page.request.get(...)`), which is what the skill's close-out snippet already does.
- **Logging in must happen in the Playwright browser window**, not your everyday browser — separate profiles, separate cookie jars. Re-signing in there restored it on 2026-09-08 (cookie `sb-<project-ref>-auth-token`).

While it was expired, ~14 applications were still submitted by calling the **same library functions the API routes wrap**, from a throwaway `.mts` run with `node --env-file=.env.local --import tsx`: `promote` logic → `generateTailoringPlan` → `applyTailoring` → `renderResumePdf` → `uploadResumePdf`, then close-out re-using the real `computeJobStatusSideEffects()` cascade so `appliedAt` and the KPI timestamps populate identically. Those records are indistinguishable from API-produced ones. Prefer the real API when the session is alive; this is the documented fallback when it is not.

Two file-resolution gotchas for that fallback: the script must live **inside the project directory** (Node's ESM resolution needs `node_modules`), and it must be `.mts` — a plain `.ts` is treated as CJS by tsx and rejects top-level `await`.

## Where to look for more

- **`apply-run` project skill** (`.claude/skills/apply-run/SKILL.md`): the playbook for actually driving a live apply run — standing default answers, per-ATS Playwright gotchas, and the real-API close-out pattern. Auto-loads when relevant; update it (not this file) when you learn a new gotcha or default.
- **Claude Code memory** (`~/.claude/projects/.../memory/`, auto-loaded every session): durable feedback/preference/project-fact entries, same spirit as this file but managed by the assistant automatically. This file is the belt to that memory system's suspenders — if memory ever gets reset or you're in a different tool entirely, this file should be enough to get going again.
- **Git log**: `git log --oneline -20` for what actually shipped recently and why (commit messages explain the "why," not just the "what").
- **This file**: if you (the assistant) learn something the next session shouldn't have to rediscover — a new gotcha, a changed default, a completed roadmap item — update this file as part of that work, not as an afterthought.
