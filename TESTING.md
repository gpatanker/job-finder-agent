# Testing Report

This documents what's been verified, how, and the exact commands to reproduce it. Everything below was actually run against the live Supabase instance, the real Claude API, and (where noted) real third-party job postings — not assumed.

## Commands

```bash
npx tsc --noEmit                    # typecheck — clean
npm run build                       # production build — clean, all routes listed
npm run test                        # Vitest: 44 tests, 12 files — all passing
npm run test:e2e                    # Playwright E2E full-flow test (needs credentials)
```

## Unit tests (Vitest, 44 tests / 12 files, no live services required)

| Area | File | What it covers |
|---|---|---|
| Resume tailoring | `src/lib/resume/apply-tailoring.test.ts` | Bullet reordering, missing-ID fallback, **fabrication guard** (a phrase swap not in the pre-approved synonym list is silently rejected), skills reordering |
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
