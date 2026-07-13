# Job Finder Agent

A personal job-application command center: track roles through a pipeline, generate ATS-friendly tailored resumes, scrape application short-answer prompts, draft grounded answers from a story bank, and queue ready applications for an external browser-automation agent to fill in and (optionally) submit.

**This app never submits an application itself.** It prepares resumes, drafts answers, and queues explicit application runs. Actual form-filling/submission is performed by a separate browser-automation step, outside this codebase, only after you authorize it.

## Status

🚧 Under active development. See `TESTING.md` (once added) for what's verified so far.

## Stack

- Next.js (App Router, TypeScript) on Vercel
- Supabase (Postgres via Drizzle ORM, Storage for generated PDFs, Auth)
- pdfkit for resume PDF generation (Carlito font, ATS-friendly real text)
- Claude API (Anthropic) for grounded answer generation, resume-tailoring keyword optimization, and agent-driven job-search suggestions

## Getting your own instance running

This repo is generic and config-driven — no one's personal data lives in source control. To run your own instance you'll need:

1. A Supabase project (Postgres + Storage + Auth)
2. An `ANTHROPIC_API_KEY`
3. Your own resume/story-bank/profile data, provided via a local config file (see `local/README.md`, added in a later step) or entered through the Settings page after deploying

Setup instructions, environment variables, and deployment steps will be filled in as those pieces are built.

## License

MIT — see `LICENSE`.
