---
name: apply-run
description: Drive a live, human-supervised job application through Playwright for job-finder-agent — known ATS gotchas (Greenhouse, Ashby, Rippling, embedded/custom forms), standing default answers for recurring application questions, and how to close out a job in the DB afterward. Use this whenever actually filling out and submitting a real job application from this app's Apply Run Brief.
---

# Driving a job-finder-agent Apply Run

The app itself never submits an application — submission always happens out-of-band, via Playwright browser automation driven by a Claude Code session (this is "the Computer" referenced in the UI/briefs). This skill is that playbook: standing defaults so you don't re-ask known answers, per-ATS gotchas learned the expensive way, and how to close the loop in the DB afterward.

Read the job's Apply Run Brief (from the Run Queue or Apply Agent page) first — it already contains the candidate's structured answers, resume link, and submit authorization. This skill fills the gaps the brief doesn't cover: how to actually operate each platform's form correctly.

## Standing default answers (don't re-ask these)

Confirmed via explicit user feedback across many sessions — treat these as resolved, not per-application judgment calls:

- Work authorization: **Yes**, unrestricted / no sponsorship needed — **despite** `candidateProfile.requiresSponsorship` being stuck at `true` in the DB (known-stale field; don't trust it, don't "fix" it without asking, just override the answer manually every time).
- "How did you hear about us": **LinkedIn**, always.
- Relocation / willing to work onsite / commute: always **Yes**. If offered a choice of office, prefer **San Francisco** over New York.
- Salary expectations: free-text field → "the posted range works for me" / flexible. Numeric field → median of the posted range.
- Age bracket (optional demographic question): candidate is 27 → **"Under 30"** if that's a listed bucket, otherwise the numeric bracket containing 27 (e.g. "21-29").
- Visa status (free text): **U.S. Citizen**.
- Security clearance eligibility: **Yes**, eligible to obtain/maintain one.
- Demographics: Gender Male; Race/ethnicity Asian (South Asian), not Hispanic/Latino; Sexual orientation Heterosexual/Straight; Veteran status not a veteran; Disability status no disability. Fill these into EEO/demographic surveys directly when the form offers matching options — optional under EEO law, but no reason to skip once known.
- HubSpot: has used it before, if asked.
- Education on multi-entry forms: list both Master's and Bachelor's. Single-entry-only forms: default to Master's, flag it so the user can override.
- Eligibility-gate questions that could self-disqualify (e.g. "do you have N years of experience in X specific narrow thing") and aren't covered by a plain fact above: **always pause and ask the user** — never guess in either direction.
- Essay/free-text answers: ~2 short paragraphs, at most one stacked number/bullet. Don't over-write.
- During a live, authorized batch run: don't re-confirm fields already known from this list — only pause for genuinely undetermined fields.

Full candidate background, story bank, and pre-written answers to common interview-style prompts live in the DB (`storyBankEntries`, `questionBankEntries`) — query them directly for essay answers rather than re-deriving from memory.

## Per-ATS gotchas

- **Greenhouse standard forms**: the phone "Country" combobox and any city/state autocomplete combobox — typing text populates a listbox but does **not** auto-select the value; you must click the matching option. Skipping this leaves the field marked invalid and blocks submission. Always click-to-confirm before assuming a field is done.
- **Ashby forms**: plain-styled "Yes/No" toggle buttons are **not** real ARIA-state radios — the accessibility snapshot's `[checked]`/`[active]` annotation is unreliable for them. Verify via `browser_evaluate` checking whether the button's `className` contains `_active_` (a CSS-module hash substring, but that fragment itself is stable). Real `<input type="radio">`/`<input type="checkbox">` elements on Ashby forms (e.g. demographic surveys) *do* report `[checked]` reliably — only the custom toggle-button pattern needs the extra check.
- **Ashby file uploads occasionally fail silently at the S3 layer** (`net::ERR_TIMED_OUT` on the `ashbyhq-infra-prd-...s3...amazonaws.com` POST) while the UI still shows the filename as if it succeeded. Always check `browser_network_requests` after a resume upload on Ashby forms — look for the S3 POST returning `204`, not just the visible filename chip. If it timed out, delete the file and re-upload.
- **Rippling's hosted ATS** (`ats.rippling.com/{company}/jobs/{id}`, click "Apply now" to reach `.../apply?...&step=application`): parses the uploaded resume and autofills fields — but verify the autofilled **Location** field, it can default to the job's own location instead of the candidate's actual location and needs manual correction. Uses a Cloudflare challenge + its own `/apply` POST; confirm success via `browser_network_requests` (the `.../apply` POST returning 200 and the URL query changing to `step=confirmation`).
- **Custom (non-ATS) company-built careers pages** (e.g. Cursor, Waymo, X/Alphabet's moonshot factory): hidden `sr-only` native inputs are often wrapped by a styled `<label>`; a direct click on the input ref can time out with "element intercepts pointer events" — click the wrapping label instead.
- **Companies that embed Greenhouse in their own custom-styled wrapper page** (e.g. buildops.com's `/careers/job-application?gh_jid=...`): the wrapper's own JS/CSS can silently break parts of the embedded form — in one case the Resume/CV upload button existed but never created a native `<input type="file">` at all (confirm via `browser_run_code_unsafe` querying `input[type=file]` counts). Fix: read the iframe's own `src` attribute (`iframe[title="Greenhouse Job Board"]`, a `job-boards.greenhouse.io/embed/job_app?for={token}&...` URL) and navigate directly to that URL — it's the real, standalone Greenhouse-hosted form and works normally, file uploads included.
- **First.cx / firststage.co** (e.g. `{company}.firststage.co/jobs/{id}/view`): a multi-step wizard, one field per page — upload the resume first (it parses and pre-fills name/preferred-name/email/phone/country on later steps automatically), then click through "Save and continue" one step at a time; verify each pre-filled value rather than assuming autofill got it right. The step counter (e.g. "Step 10 of 10") doesn't include a bonus optional demographic-survey step that appears afterward, before the final "Check your answers" review page — don't stop at the last numbered step. The review page lists every answer with a "Change" link per field; confirm everything reads correctly before clicking "Confirm and submit," then verify the resulting URL ends in `/submitted` and the page shows "Application submitted."
- **Greenhouse's native react-select comboboxes** (seen on stripe.com's own careers site, a direct `iframe[title="Greenhouse Job Board"]` embed, not a custom wrapper): `.fill()` populates the input but doesn't fire the keystroke events the search handler listens for, so no options ever appear — use `browser_type` with `slowly: true` instead. If a field already has stale text in it, clear it first (`ControlOrMeta+a` then `Backspace`) or the new text gets appended, not replaced. Some of these comboboxes are short static lists (e.g. "US"/"UK"/country name lists, Yes/No, degree level) that show all options immediately on click with no typing needed — try clicking first before assuming you need to type-to-search. A checkbox-group answer (e.g. "which countries do you anticipate working in") can also conditionally reveal a new required dropdown afterward (e.g. selecting "Hispanic/Latino: No" revealed a separate "Please identify your race" dropdown) — re-snapshot after each answer rather than assuming the field list is fixed.
- **A company's Greenhouse board token doesn't always match their public brand name** — don't assume `job-boards.greenhouse.io/{obvious-slug}/jobs/{id}` resolves; if it 404s or redirects back to the company's own site, get the real token from the embed script's `for=` param instead.

## General verification patterns

- **Ashby (and possibly other React-controlled) text inputs can silently desync after `fill()`**: the DOM/visible value updates, but the framework's internal state doesn't, so a post-submit validation banner reports the field as empty even though it visibly shows the right text (seen on Assort Health's Ashby form, Email field specifically — other fields on the same form were unaffected). Fix: click into the field, select-all + delete to confirm it's actually empty at the DOM level (`el.value`), then retype with `browser_type` using `slowly: true` (dispatches real keystroke events) rather than `fill()`. **Don't just retype on top of a `fill()`ed field** — if the old value is still in the DOM, this duplicates it (e.g. `gpatanker@gmail.comgpatanker@gmail.com`); always verify the field is empty first via `browser_evaluate` reading `.value`. If a "form needs corrections" banner appears after submit, treat every flagged field this way, then resubmit.

- **Submissions with no obvious on-page success banner**: check `browser_network_requests` for the actual form-submission POST and its status code (200/204/202 = success) rather than trusting visible text alone.
- **A platform can reject a submission outright** for reasons outside your control — e.g. Fluidstack enforces "no more than 2 applications per 100 days" / "no reapply within 365 days if not offered," and returns an explicit alert for a role apparently already applied to (outside this system's own tracking). When this happens: don't force it, don't retry differently — mark the job `blocked` with the platform's own rejection message as the `resultSummary`, and move on.
- **The packet scraper can report "no candidate-written prompts found" even when the live Ashby form has several custom essay questions** (seen on Harper's Special Projects Lead posting — 5 free-text prompts including "why this company," a messy-ambiguous-problem story, and a pick-one-and-justify question, none caught by the scrape). Don't take a clean scrape as proof the form is just standard fields — always snapshot the actual live form before assuming there's nothing to write. When this happens, pull material from `storyBankEntries` for personal-story prompts rather than improvising, and keep answers to the same ~2-short-paragraphs style as scraped prompts.
- **Genuine posting-closed-between-triage-and-apply is real market churn**, not a bug — verify against the live board one more time before concluding a bug caused it.
- **DB writes can transiently fail** (`CONNECT_TIMEOUT` to the Supabase pooler) even when the network path is otherwise fine. Just retry the same script after a short delay; don't over-investigate a one-off timeout.

## Closing out a job afterward

**Always close out through the real API now, not raw SQL against `agent_run_queue`/`jobs` directly.** The API routes are what populate `startedAt`/`completedAt` (used for the Overview page's "avg time to submit" and "manual time saved" KPIs), cascade `jobs.status → "applied"` + set `jobs.appliedAt`, and cascade a block reason onto `jobs.blockReason` — a raw-SQL update bypasses all of that side-effect logic and leaves those KPIs blank for the run. Direct-DB scripts should only be a last resort if the API is genuinely unreachable.

The app's routes require an authenticated session, so drive them through the same authenticated browser context already used for the apply run itself (reusing its `localhost:3000` cookies, the same pattern used elsewhere in this skill for downloading resume PDFs) via `browser_run_code_unsafe`:

```js
async (page) => {
  const cookies = await page.context().cookies("http://localhost:3000");
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await page.request.patch(`http://localhost:3000/api/agent-runs/${runId}`, {
    headers: { cookie: cookieHeader, "Content-Type": "application/json" },
    data: {
      status: "completed", // or "blocked"
      // blocked runs only:
      // resultSummary: "...",
      // blockReason: "anti_bot_captcha" | "posting_removed" | "eligibility_gate_unresolved" | "out_of_scope_action" | "account_creation_required" | "other",
      // set true on either outcome if a mid-flight pause to ask the user was needed:
      // requiredManualInput: true,
    },
  });
  return { status: res.status(), body: await res.json() };
};
```

If the run was never flipped to `"in_progress"` earlier in the session (so `startedAt` is still unset), PATCH `{ status: "in_progress" }` first — otherwise the completing PATCH sets `startedAt` and `completedAt` to the same instant, understating the run's actual duration.

This single PATCH replaces the old two-table raw-SQL script — `jobs.status`/`applyAgentStatus`/`appliedAt`/`blockReason` all cascade automatically from it. Still delete the job's resume PDF from `.playwright-mcp/` immediately after closing out, so stray files don't accumulate (check `.playwright-mcp/*.pdf` for leftovers periodically; they're a sign of an incompletely-closed-out job).

If the API is genuinely unreachable (e.g. dev server down), fall back to a throwaway `.mjs` script written with the `Write` tool **inside the project directory** (not the scratchpad — Node's ESM resolution needs to find `node_modules`), run via `node --env-file=.env.local ./script.mjs`, always ending with `process.exit(0)` — but in that case, manually set `appliedAt`/`blockReason`/`startedAt`/`completedAt` yourself in the same script, since there's no route left to do it for you.
