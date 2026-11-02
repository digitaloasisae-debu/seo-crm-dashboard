# SEO Control Center (CRM dashboard)

Replaces the "Blog Automation - Client Data" Google Sheet as the backend for the n8n content pipeline.

- **Tally → dashboard:** onboarding and keyword forms post straight into the database (signed webhooks).
- **Approvals in the UI:** keywords, topics and articles are reviewed per client.
- **WordPress push from the dashboard:** approved articles go to WordPress as drafts. n8n never sees the passwords.
- **Roles:** Super Admin (all clients), Admin (own clients + access on request), Member (assigned clients only).
- **Encrypted credentials:** WordPress application passwords are stored AES-256-GCM encrypted, with the key held only in env vars.

Stack: Next.js 15 (App Router) · TypeScript · Prisma · Postgres (Supabase) · Auth.js · Tailwind 4. Deploys to Vercel.

---

## 1. Set up locally

Requires Node 20+.

```bash
npm install
cp .env.example .env        # then fill it in (see below)
npx prisma db push          # creates the tables
npm run db:seed             # creates the Super Admin from SEED_ADMIN_*
npm run dev                 # http://localhost:3000
```

### Environment variables

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` / `DIRECT_URL` | Supabase → Project Settings → Database → Connection string. Pooled (6543) and direct (5432). |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `APP_URL` | Public URL of the dashboard |
| `ENCRYPTION_KEY` | `npm run gen:key`. **Back this up somewhere safe.** If you lose it, every saved WordPress password has to be re-entered. |
| `ENCRYPTION_KEY_VERSION` | Leave at `1` (see "Rotating the key" below) |
| `SEED_ADMIN_*` | Your Super Admin login (password 10+ characters) |
| `TALLY_ONBOARDING_SIGNING_SECRET` / `TALLY_KEYWORDS_SIGNING_SECRET` | From each Tally form's webhook settings |
| `TALLY_KEYWORDS_FORM_URL` | Public link of the keyword form, e.g. `https://tally.so/r/abc123` |
| `N8N_API_TOKEN` | `openssl rand -hex 32`. n8n sends this as a Bearer token. |
| `N8N_ALLOWED_IPS` | Optional. Your Hostinger VPS public IP, so only n8n can call the API. |
| `N8N_WF1_WEBHOOK_URL` / `N8N_WF2_WEBHOOK_URL` | Optional. Webhook-trigger URLs for the "Run n8n now" buttons. |

## 2. Deploy (Vercel + Supabase)

1. Create a Supabase project (choose a region close to your team) and copy the two connection strings.
2. In the project folder run `npx vercel` (no Git repo needed), then add every variable from `.env.example` under Vercel → Settings → Environment Variables, and run `npx vercel --prod`.
3. The `vercel-build` script creates or updates the tables (`prisma db push`, which refuses changes that would delete data) and the Super Admin on every deploy.
4. Open the Vercel URL and sign in as the Super Admin.
5. Go to **Team** and add Sana (Admin), then Aiman, Ambreen, Talhat and the others (Member).

Later schema changes: switch to migrations with `npx prisma migrate dev --name <change>` locally and `npm run db:deploy` in production.

## 3. Connect Tally

For each form: Integrations → Webhooks → add the endpoint, then turn on a **signing secret** and copy it into env.

| Form | Endpoint |
| --- | --- |
| Client Onboarding | `https://<APP_URL>/api/webhooks/tally/onboarding` |
| Keywords | `https://<APP_URL>/api/webhooks/tally/keywords` |

- Fields are matched by **label prefix**, the same rule WF0 used, so the current forms work unchanged ("Client / Business Name", "Website URL", "WordPress Application Password", and so on). See `src/lib/intake.ts`.
- **Keyword form:** add a Hidden field named `client_slug`. Each client's Overview page shows its prefilled link (`…?client_slug=houston-gate-repair`), so a typo in "Client Name" can't send keywords to nowhere. Typed names still work as a fallback.
- Keywords from Tally are **auto-approved** (each client has an "Auto-approve keywords" setting, on by default).
- The onboarding submitter is made the client's **Owner** if their name or email matches a team account.
- The WordPress password is encrypted as soon as it arrives and removed from the stored submission.
- Anything that fails (for example an unknown client name) shows on **Intake**, where you can pick the right client and retry.

## 4. Switch n8n from Google Sheets to the dashboard

**Ready-made copies:** `n8n/WF1-dashboard-test.json` and `n8n/WF2-dashboard-test.json` are your WF1 and WF2 with every change below already made. Your Gemini prompts, Firecrawl scraping, images and styling are unchanged. Unused branches are removed. Replace `https://YOUR-DASHBOARD-URL` with your dashboard URL before importing, then pick the "Dashboard API" credential on the HTTP Request and Webhook nodes. Your Firecrawl and imgbb API keys were taken out of these files so they never sit in the repository. After importing, paste them back where the nodes say `YOUR_FIRECRAWL_API_KEY` (the Firecrawl/Scrape nodes) and `YOUR_IMGBB_API_KEY` (the imgbb upload nodes). WF1 no longer has a Tally trigger: the dashboard calls WF1's webhook whenever keywords arrive, so it runs on the same events as before.

In n8n (Hostinger), create a **Header Auth** credential: name `Authorization`, value `Bearer <N8N_API_TOKEN>`. Then replace each Google Sheets node with an **HTTP Request** node that uses that credential:

| Workflow | Old node(s) | New HTTP Request |
| --- | --- | --- |
| WF0 | Tally Trigger + whole workflow | **Retire it.** The dashboard webhook creates the client, its posting dates and its encrypted credentials. |
| WF1 | Tally Trigger → Split Keywords → Append row | **Retire this branch.** The keyword webhook replaces it. |
| WF1 | Read Client Config | `GET /api/n8n/clients?active=true` |
| WF1 | Read Keyword Pool + Select Top 10 Unused Approved | `GET /api/n8n/clients/{{$json.id}}/keywords?status=approved&used=false&limit=25` |
| WF1 | Append to Topic Queue + Mark Keywords Used | `POST /api/n8n/clients/{{id}}/topics` with body `{"topics":[{"keyword","topic","category","angle","secondary_keywords"}]}`. Marks the keywords used in the same call. |
| WF2 | Get row(s) in sheet + Filter & Select Keyword | `GET /api/n8n/topics?status=approved&has_article=false&client={{id}}` returns `topic_id`, `selected_keyword`, `secondary_keywords`, `topic`, `angle`, `category` |
| WF2 | Read Client Profile | `GET /api/n8n/clients/{{client_id}}`. Same column names as the sheet; **no WordPress credentials**. |
| WF2 | Append or update row (branding) | `PATCH /api/n8n/clients/{{id}}/branding` with `{"brand_primary_color","brand_secondary_color","brand_accent_color","logo_url"}` |
| WF2 | Upload Featured Image to WordPress Media, Build WP Payload, the WordPress HTTP Request, Mark Topic Row as Drafted, Update Topic Queue Row | **Replace all with one call:** `POST /api/n8n/topics/{{topic_id}}/article` with `{"meta_title","meta_description","url_slug","content_html" or "content_markdown","featured_image_url"}`. Use the imgbb URL as `featured_image_url`. |

After that call the article waits on the review screen. When someone approves it, the dashboard uploads the featured image to the client's media library, creates the WordPress draft (with the same Rank Math meta WF2 sent), dates it to the next open posting slot, and saves the post link.

**Webhooks:** the copies have a "Dashboard Trigger" webhook (`/webhook/dashboard-wf1`, `/webhook/dashboard-wf2`) protected by the same Header Auth credential. Put their production URLs in `N8N_WF1_WEBHOOK_URL` / `N8N_WF2_WEBHOOK_URL`. That powers the "Run n8n now" buttons and the automatic WF1 run after a keyword submission.

## 5. Import the existing Google Sheet

1. Export these tabs as CSV into a folder named `imports/` in the project: `Client Config.csv`, every `Keyword Pool - <Client>.csv` and every `Topic Queue - <Client>.csv`. Keep Google's default file names, which are the tab names.
2. Dry run: `npm run import:sheets`. It prints counts and any rows that don't map. Nothing is written.
3. Import: `npm run import:sheets -- --commit`. Passwords are encrypted on the way in, and re-running skips what's already there.
4. Topics already marked "Drafted" are imported as pushed articles, linked to their WordPress post, so they aren't written twice.
5. Delete the `imports/` folder afterwards, because `Client Config.csv` contains plain-text passwords.

Suggested cutover: import the sheet, run one monthly cycle with n8n on the API while the sheet stays read-only, then switch the Tally webhooks and archive the sheet.

## How access works

| Capability | Super Admin | Admin | Member |
| --- | --- | --- | --- |
| See clients | All | Own + granted | Own |
| Approve keywords, topics, articles and push | All | Own + granted with Edit | Own |
| Set WordPress credentials | Yes | No | No |
| Assign clients, grant access, manage team | Yes | Request only (Access page) | No |
| Intake log | Yes | Yes | No |

Grants can expire. Every change is written to the activity log shown on each client's Overview.

## Content lifecycle

- **Keyword:** pending → approved / rejected → used (marked when WF1 turns it into a topic)
- **Topic:** generated → approved / rejected (editing a topic sends it back to review)
- **Article:** ready_for_review → changes_requested or approved → pushing → pushed_draft / push_failed (retry from the article page)

## Security notes

- WordPress passwords: AES-256-GCM with a random IV per secret. The key is only in env. Passwords are decrypted in memory just for the WordPress call, never sent to the browser or to n8n, and never logged.
- Tally webhooks require a valid HMAC signature. The n8n API requires the Bearer token and can be limited to your VPS IP.
- Article HTML from n8n is sanitized (scripts and event handlers stripped) before it is stored and shown.
- Rotating the key: set the new key as `ENCRYPTION_KEY`, move the old one to `ENCRYPTION_KEY_1`, and set `ENCRYPTION_KEY_VERSION=2`. Old secrets still decrypt, and re-saving a credential re-encrypts it with the new key.

## Project layout

```
prisma/schema.prisma        data model
prisma/seed.ts              creates the Super Admin
scripts/import-sheets.ts    one-time Google Sheets import
src/lib/crypto.ts           AES-256-GCM helpers
src/lib/access.ts           role + per-client access checks
src/lib/intake.ts           Tally field mapping and processing
src/lib/wordpress.ts        test connection + draft push
src/app/api/webhooks/tally  Tally endpoints
src/app/api/n8n             n8n API
src/app/(app)               dashboard screens
src/app/actions.ts          all form actions (approve, push, assign…)
```

## Not in this version (next phases)

- DataForSEO rank tracking and SERP metrics
- Google Search Console clicks, impressions and indexing (the `gscAccount` field is already captured)
- PageSpeed Insights / Lighthouse audits
- Email notifications and client-facing reports
- Background queue (Inngest) for pushes. Today a push runs in the request with 3 retries, up to 60 seconds.
