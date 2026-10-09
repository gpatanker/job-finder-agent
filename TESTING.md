# Testing Report

This documents what's been verified, how, and the exact commands to reproduce it. Everything below was actually run against the live Supabase instance, the real Claude API, and (where noted) real third-party job postings — not assumed.

## Commands

```bash
npx tsc --noEmit                    # typecheck — clean
npm run build                       # production build — clean, all routes listed
npm run test                        # Vitest: 333 tests, 33 files — all passing
npm run test:e2e                    # Playwright E2E full-flow test (needs credentials)
```

## Unit tests (Vitest, 333 tests / 33 files, no live services required)

| Area | File | What it covers |
|---|---|---|
| Resume tailoring | `src/lib/resume/apply-tailoring.test.ts` | Bullet reordering, missing-ID fallback, **fabrication guard** (a phrase swap not in the pre-approved synonym list is silently rejected), skills reordering — plus the reword path end to end: a valid rewrite is applied, one that invents a metric or a tool or changes a number's magnitude is discarded in favour of the original, a valid rewrite takes precedence over synonym swaps for the same bullet, and a rejected one falls back to them |
| Deterministic fallback | `src/lib/resume/deterministic-tailoring.test.ts` | Keyword-overlap ranking of bullets/skills, empty-JD edge case, never sets `phraseChoices` |
| Keyword extraction | `src/lib/text/keywords.test.ts` | Stopword removal, frequency ranking, limit — caught and fixed a real bug (trailing punctuation like `"negotiation."` wasn't stripped) |
| Resume coverage scoring | `src/lib/resume/keyword-coverage.test.ts` | `scoreCoverage`/`missingKeywords` against a fixture resume |
| PDF generation | `src/lib/resume/render-pdf.test.ts` | Renders a **generic fixture resume** (not personal data), verifies exactly 1 page, correct `Author`/`Title`/`Producer` metadata, real extractable ATS-friendly text, and a **golden-master snapshot** of the extracted text to catch future layout regressions |
| Prompt scraping | `src/lib/scraping/greenhouse.test.ts`, `generic.test.ts` | Parses saved HTML fixtures (trimmed excerpts of real Greenhouse markup) — essay question extracted, standard/PII fields excluded, "GitHub URL"-style short fields correctly excluded |
| Answer-generation retrieval | `src/lib/answers/select-stories.test.ts` | Keyword-based story ranking picks the right story first |
| Apply Agent checklist | `src/lib/apply/readiness.test.ts` | All 5 checklist conditions, complete/incomplete states |
| Packet readiness | `src/lib/packet/readiness.test.ts` | All 4 states (no_scan / scanned_empty / needs_approval / ready) |
| Apply Run Brief | `src/lib/apply/brief.test.ts` | Submit-authorized vs. do-not-submit blocks, candidate basics, resume route, approved answers, "no approved prompts" case |
| Slugs | `src/lib/resume/slug.test.ts` | Slugify + per-job resume slug generation |
| **Rewrite guard** | `src/lib/resume/rewrite-guard.test.ts` | The safety boundary for LLM-reworded bullets: numbers must survive character-for-character (`$3M` → `$3 million` is rejected), no new digit run may appear, proper nouns/acronyms may neither be dropped nor invented, the leading action verb is exempt but a leading acronym is not, length must stay in a 0.55–1.6× band, and a bullet's own pre-approved synonyms count as supporting vocabulary |
| **One-page fitter** | `src/lib/resume/fit-one-page.test.ts` | `countPdfPages()` against real rendered output, and the give-back priority order — length-adding items first, synonym swaps before keyword-bearing rewrites, older roles before the current one — plus the "base resume itself is too long" report when nothing is left to give back |
| **Live-board identity** | `src/lib/search/live-board.test.ts` | `matchLiveJob` prefers an exact normalized-title match, takes the best-scoring loose match rather than the first, and returns `null` on a tie; `sameBoardUrl` ignores tracking params so one posting isn't seen as two |
| Query rotation | `src/lib/search/perplexity-discover.test.ts` | Whole-slice rotation (consecutive steps share no phrases), fresh and widen passes drawing disjoint slices within a run, and `rotationSeed` pinning the step for determinism |
| Role-family scope | `src/lib/search/known-company-boards.test.ts` | The GTM/revenue-motion exclusion and its Business-Operations rescue clause, asserted against the real title corpus — including that "Sales Operations" stays in scope while "Revenue Operations" does not |
| Exa channel | `src/lib/search/exa-discover.test.ts` | Query parity with the Perplexity builder (the A/B's core assumption), the ATS domain filter sent as `includeDomains`, `excludeDomains` sent only for the opted-in tuned arm, date-format conversion (MM/DD/YYYY → ISO 8601), actual `costDollars` preferred over the modelled rate card, citation dedupe across queries, and partial results plus a warning when some queries fail or the key is unset |
| **Role scope** | `src/lib/search/role-scope.test.ts` | That the title filter is retargetable by data: the ops corpus classifies unchanged, `classifyRoleFamily("Product Manager")` flips from null to core purely by swapping scope, the `bareHeadIsCore` distinction (bare head noun is noise for ops and the target for product), the opt-in excluded-family carve-out, the seniority split on "principal" (executive in ops, senior IC in product), regex-metacharacter escaping in scope terms, `_`-prefixed comment-key stripping, and null overrides falling back to the preset rather than blanking a list |
| **Scope derivation guard** | `src/lib/search/role-scope-agent.test.ts` | What a generated scope must satisfy before it's accepted — and most importantly the **self-check**: a scope that rejects every role family the candidate named is wrong by construction, however reasonable its word lists look. Also the contradiction guard (a term in both `headTerms` and `disqualifyingDomains` rejects everything — the exact failure that made a software engineer's search return nothing), empty `headTerms`/`rubricRules`, `rescuePhrases` with nothing to rescue from, and the warn-not-fail path when only *some* stated families are rejected since one may be aspirational |
| Employer research | `src/lib/company/company-context.test.ts` | Cache-key normalization (punctuation/case collapsed so one employer is cached once; a nameless company yields an empty key callers treat as a no-op) and `formatCompanyContext` rendering — empty string when there is no profile so the prompt is unchanged, the signals line omitted when research found none, and the instruction not to claim anything the bullets don't support |

### Known coverage gaps

- **The self-URL short circuit in `resolveCandidateFreshness` is not unit-tested.** It is the fix for the URL-rewrite bug described in [`ARCHITECTURE.md`](ARCHITECTURE.md#identity-not-similarity) and was verified by observed behaviour in production runs (net-new suggestions per run going from 1 to 31), not by a test. `resolve-freshness.test.ts` covers the fail-open paths around it but not this branch.
- **`getCompanyContext`'s caching and staleness logic is not unit-tested.** `company-context.test.ts` covers the pure helpers (`companyKeyFor`, `formatCompanyContext`); the 120-day staleness window, the insert/update path and the fail-soft-to-`null` behaviour all require a DB and were verified by use, not by test.
- **`generateTailoringPlan`'s plan validation is only covered for the retry path.** `tailoring-agent.test.ts` asserts the `tool_result` regression; the `bulletRewrites` shape-validation branch is exercised indirectly through `apply-tailoring.test.ts` rather than directly.

## Playwright E2E (`tests/e2e/full-flow.spec.ts`)

Runs the complete real flow against a live dev server, live Supabase, and live Claude API: create + approve a job → generate & attach a tailored resume (verifies PDF served with `200`/`application/pdf`) → scrape a **real Greenhouse posting's essay question** → generate + approve an answer from the story bank → complete the Apply Agent checklist → queue a run → confirm it appears in Run Queue → transition status → clean up.

Requires `E2E_LOGIN_EMAIL`/`E2E_LOGIN_PASSWORD` (a real Supabase Auth account) — skips itself if unset, and never hardcodes credentials since this repo is public.

**This test caught a real bug during development**: the Apply Agent's "confirm review" checkbox was a controlled input with no optimistic update, so clicking it visually flickered back to unchecked while the PATCH request was in flight, and Playwright's `.check()` correctly failed on it. Fixed with an optimistic update + revert-on-error.

## Manual verification performed during development (with real data/services)

These were exercised by hand against the live Supabase instance and real third-party sites while building each feature; the Playwright E2E test above now automates the core path, but a few additional things were specifically checked manually:

- **PDF one-page + text extraction**: confirmed via `pdf-parse` (`"total": 1`, full text matching source content near-verbatim) on both the base resume and a Claude-tailored version.
- **PDF served from production (Vercel)**: created a job, called `generate-resume`, fetched the resulting PDF from the deployed serverless function — `200`, `application/pdf`, correct byte count. This specifically validated that `outputFileTracingIncludes` correctly bundles the Carlito font files into the serverless function (a real risk with pdfkit + bundlers).
- **Greenhouse scraping against real live postings**: fetched 5 different real Snorkel AI job postings; 4 had zero essay questions (correctly returned empty + honest warning), 1 had a real essay question (correctly extracted, matching the live page's exact wording).
- **Ashby scraping honesty check**: fetched a real live Ashby posting (`jobs.ashbyhq.com/ashby/...`) and inspected the raw HTML plus Ashby's public `posting-api` — confirmed the application form/questions are not present in either, which is why the scraper returns an explicit limitation warning instead of silently returning nothing.
- **Job Search Agent, live web search**: ran a real search against the seeded candidate profile — returned 8 genuine, currently-open postings (OpenAI, CoreWeave, Snorkel AI, Anthropic, Databricks) with real apply/source URLs and well-reasoned match scores/rationales. Promoted one to the pipeline, confirmed it landed in the `jobs` table, then cleaned up.
- **Duplicate active-run prevention**: creating a second apply run for a job with an existing `queued`/`in_progress` run returns `409`; a new run is allowed once the prior one is `completed`.
- **Sample-data gating**: seeded 2 demo jobs (`is_sample=true`), confirmed zero leak into `GET /api/jobs` or the Pipeline page with `SEED_DEMO_DATA` unset, then ran the cleanup script and confirmed removal.
- **Auth gate on production**: confirmed the live Vercel deployment redirects `/` → `/login` (307) for unauthenticated requests, and that API routes return `401` JSON (not an HTML redirect) for unauthenticated calls.
- **RLS verification**: queried `pg_tables` directly to confirm `rowsecurity = true` on all tables after migration, on the live database.

## Known limitations (see also README)

- Ashby scraping cannot work via simple HTTP fetch (see README "Known limitations" for the technical reason) — this is a hard platform constraint, not a bug to fix.
- The Playwright E2E test is an integration test requiring real credentials and API keys; it is not run in CI for this repo (no secrets are configured for a public repo's Actions by default). Run it locally with your own `.env.local`.
- No automated test exercises the Vercel Preview-environment deploy path, since Preview env vars aren't currently configured (see README).
