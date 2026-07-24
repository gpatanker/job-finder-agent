# Deployment Guide

This app is deployed as: **Vercel** (Next.js hosting + serverless functions) + **Supabase** (Postgres + Storage + Auth). This guide walks through setting up your own instance from scratch, matching exactly how this project's own instance was set up.

## 1. Create a Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → New Project. Any name/region is fine.
2. Once provisioned, go to **Project Settings → API Keys** and copy:
   - Project URL (or construct it from the Project ID shown on the General settings page: `https://<project-id>.supabase.co`)
   - **Publishable key** → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **Secret key** → this is `SUPABASE_SERVICE_ROLE_KEY` (full access — treat like a password)
3. Get your Postgres connection string: click the green **Connect** button at the top of any Supabase dashboard page → **Direct** tab (Connection string) → copy the **Transaction pooler** mode URI. Replace `[YOUR-PASSWORD]` with your actual database password (set at project creation, or reset it under Project Settings → Database if forgotten). This is `DATABASE_URL`. If your password contains special characters (e.g. `!`), percent-encode them (`!` → `%21`).

## 2. Get an Anthropic API key

[console.anthropic.com](https://console.anthropic.com) → Settings → API Keys → Create Key. This is `ANTHROPIC_API_KEY`.

## 2b. Get a Perplexity API key

[perplexity.ai/settings/api](https://www.perplexity.ai/settings/api) → Generate API Key. This is `PERPLEXITY_API_KEY`, used for the broad-discovery step of the Job Search Agent (Sonar API). If left unset, Search/Import will return a warning and no candidates instead of failing outright.

## 3. Local setup

```bash
git clone https://github.com/gpatanker/job-finder-agent.git
cd job-finder-agent
npm install
cp .env.example .env.local
# fill in .env.local with the values from steps 1-2
npm run db:migrate
```

`db:migrate` creates all tables with Row Level Security enabled and zero policies — verify with:
```bash
node --env-file=.env.local -e "
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
sql\`select tablename, rowsecurity from pg_tables where schemaname = 'public'\`.then(r => { console.log(r); sql.end(); });
"
```
All rows should show `rowsecurity: true`.

## 4. Create a Storage bucket for resumes

The private `resumes` bucket is created programmatically (not part of the SQL migration). Run once:
```bash
node --env-file=.env.local -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
supabase.storage.createBucket('resumes', { public: false }).then(r => console.log(r));
"
```

## 5. Seed your profile, resume, and story bank

```bash
cp local/profile.example.json local/profile.seed.json
cp local/resume.example.json local/resume.seed.json
cp local/story-bank.example.json local/story-bank.seed.json
# edit those three files with your real information
npm run db:seed-profile
```

## 6. Create your login account

Supabase Dashboard → Authentication → Users → **Add user**. Use the email/password you'll sign in with — this app gates every route behind a single-account Supabase Auth check (`src/proxy.ts`), since it deploys to a public URL but holds personal data.

## 7. Deploy to Vercel

```bash
npm install -g vercel   # if not already installed
vercel login
vercel link             # creates/links a Vercel project, connects to your GitHub repo
```

Push the same env vars from `.env.local` to Vercel for Production and Development:
```bash
for name in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL ANTHROPIC_API_KEY PERPLEXITY_API_KEY; do
  value=$(grep "^$name=" .env.local | cut -d= -f2-)
  printf '%s' "$value" | vercel env add "$name" production
  printf '%s' "$value" | vercel env add "$name" development
done
printf '0' | vercel env add SEED_DEMO_DATA production
printf '0' | vercel env add SEED_DEMO_DATA development
```

Then deploy:
```bash
vercel --prod
```

Once linked, every push to `main` auto-deploys via Vercel's GitHub integration — no need to run `vercel --prod` manually again.

### Note on Preview-environment env vars

Adding env vars to the `preview` environment via `vercel env add NAME preview --value <value> --yes` hit a CLI quirk during this project's setup (kept asking for a git branch despite following the suggested non-interactive command). Not blocking if you only deploy from `main`; if you need Preview deployments (e.g. for pull requests), you may need to add them via the Vercel dashboard UI instead, or pass an explicit branch name as the CLI suggests.

## 8. Verify

```bash
curl -sI https://your-deployment.vercel.app/          # expect 307 -> /login
curl -s -o /dev/null -w "%{http_code}" https://your-deployment.vercel.app/login   # expect 200
```

Then sign in with the account from step 6 and confirm the Pipeline/Settings pages load with your seeded data.

## Architecture notes

- **No headless browser anywhere** — Vercel serverless functions can't run a persistent one, and this app deliberately never drives a browser. Scraping is fetch/HTML-based; actual form-filling/submission happens in a separate tool you point at the Run Queue.
- **PDF generation runs in a serverless function** — `next.config.ts` has an `outputFileTracingIncludes` entry ensuring the bundled Carlito font files are included in that function's deployment bundle (verified working on live Vercel, not just locally).
- **RLS + service-role split is what protects this app in production** — the `anon` key is necessarily public (ships in the browser bundle for Supabase Auth), but RLS-with-no-policies means it gets zero access to any table. Only the server-side `DATABASE_URL`/service-role connection can read or write.
