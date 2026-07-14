# Roadmap

This is a single-user personal tool by design — the near-term goal was never multi-tenancy. This roadmap sketches what would actually need to change to make it a multi-user product, without overbuilding for that future today.

## Current architecture already helps

- **Config-driven, not hardcoded**: profile/resume/story-bank data lives in the database (seeded from local files), not baked into application code. A multi-user version doesn't need to rearchitect this — it needs to key it by user.
- **RLS is already enabled on every table.** Today it has zero policies (deny-all except the server-side service-role connection). Multi-user would mean adding real policies scoped to `auth.uid()` instead of removing RLS.
- **The three agents (Resume Tailoring, Answer Generation, Job Search) are already parameterized by the data passed in** — none of them hardcode "Gaurav's" data; they operate on whatever `ResumeData`/`CandidateProfile`/story bank rows are passed to them.

## What would need to change

1. **Add a `user_id` column to every user-owned table** (`jobs`, `application_questions`, `agent_run_queue`, `candidate_profile`, `resume_profile`, `story_bank_entries`, `job_search_suggestions`), and replace `candidate_profile`/`resume_profile`'s "singleton row" assumption (`.limit(1)`, always-replace-wholesale) with proper per-user rows.
2. **Real RLS policies** scoped to `auth.uid() = user_id`, replacing the current deny-all-except-service-role posture. This is genuinely more secure than today's approach for a multi-user app, since it lets you use the `anon`/user JWT directly from the browser via Supabase's client libraries instead of proxying everything through server-only API routes.
3. **Signup flow.** Today, accounts are created manually via the Supabase dashboard (single account, by design). Multi-user needs a real signup/onboarding flow — likely still gated (invite-only or waitlist) rather than open signup, given the app handles resumes and personal data.
4. **Per-user Storage paths.** The `resumes` bucket currently stores `{slug}.pdf` at the bucket root; multi-user would namespace by user ID (`{userId}/{slug}.pdf`) with Storage RLS policies to match.
5. **Rate limiting / cost controls on the agents.** The Resume Tailoring Agent, Answer Generation, and Job Search Agent all call the Anthropic API; today usage is bounded only by one person's judgment. Multi-user needs real per-user rate limits and likely a usage/billing model, since Job Search Agent runs in particular (multiple web searches per run) have real marginal cost.
6. **Background worker for Job Search Agent runs.** Today it's a synchronous API call (acceptable for one user clicking a button occasionally). At scale, this should move to a queued background job so a slow search doesn't tie up a web request, and so many users can't trigger concurrent expensive searches synchronously.
7. **Multi-tenant browser-automation handoff.** The Run Queue's `next` endpoint currently assumes a single external "Computer" consumer. Multi-user would need per-user run isolation and likely a proper worker/queue system (not just polling one Postgres table) if automation volume grows.
8. **Auth via Supabase Auth's full feature set** — password reset, email verification, session management UI — rather than today's minimal single-account login page.

## What's deliberately NOT on this roadmap

- A public marketing site / landing page — this stays a tool you deploy for yourself (or fork), not a hosted SaaS, unless that changes explicitly.
- Building any of the above speculatively before there's a second real user. Per the original build philosophy: don't overbuild multi-tenancy for a single-user tool.
