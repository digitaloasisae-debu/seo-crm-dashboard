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
| `GEMINI_IMAGE_MODEL` | Optional. Image model for Social Studio photos (default `gemini-3.1-flash-image`, falls back to `gemini-2.5-flash-image`). |
| `META_ACCESS_TOKEN` | Optional. Long-lived Meta (Facebook) user or page token with instagram_basic, instagram_manage_insights and pages_read_engagement, for Social Studio competitor research. `META_GRAPH_VERSION` overrides the Graph API version (default `v26.0`). |
| `GEMINI_SOCIAL_MODEL` | Optional. Text model for Social Studio ideas and captions (default: `GEMINI_WRITER_MODEL`, then `GEMINI_MODEL`). |

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

1. Add the team on the **Team** page first (Sana, Aiman, Ambreen, Talhat…). Each client is assigned to the person named in its "Submitted By" column, matched by name.
2. In Google Sheets: **File → Download → Microsoft Excel (.xlsx)**.
3. In the dashboard (Super Admin): **Import** → choose the file → **Preview**. It lists every client with its keyword and topic counts, the team matches, and anything to check. Nothing is saved.
4. Click **Import**. WordPress passwords are encrypted on the way in. Re-running skips what's already there, so it's safe to import again after adding a missing team member.
5. Topics marked "Drafted" become pushed articles so they're never written twice. Blank keyword statuses count as approved (same rule as Tally keywords). The "Brand Profiles" tab isn't imported yet.
6. Delete the downloaded file afterwards, because it contains plain-text passwords.

Command-line alternative: `npm run import:sheets -- "file.xlsx"` (preview) and add `--commit` to import.

## 6. SEO: site audits and Search Console

**Site audit** (each client's SEO tab, "Run audit"): reads robots.txt and the sitemap, checks up to 25 pages (titles, meta descriptions, H1s, canonicals, alt text, thin content, noindex, broken links up to 60 URLs) and runs PageSpeed Insights for mobile and desktop. Set `PAGESPEED_API_KEY` or Google rate-limits PageSpeed. The overview of every client is on the **SEO** page.

**Search Console** (keyword performance):

1. Google Cloud: enable the **Google Search Console API** and **PageSpeed Insights API**.
2. OAuth consent screen: External, add the `webmasters.readonly` scope, then **Publish app** (in Testing mode Google expires the connection after 7 days).
3. Credentials → OAuth client → Web application, redirect URI `<APP_URL>/api/google/callback`.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `CRON_SECRET` in Vercel and redeploy.
5. Super Admin → **Google** → Connect. Clients are linked to their property by domain automatically; fix any others with the dropdown. Several Google accounts can be connected.

A daily Vercel cron (`/api/cron/gsc`, 05:00 UTC) refreshes the data; anyone with edit access can also press "Refresh now". Each client stores 90 days of daily totals, weekly top 250 queries and the top 100 pages. Keyword pages show the current Search Console position and clicks for each pool keyword.

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
src/lib/audit.ts            site audit + PageSpeed
src/lib/google.ts           Google OAuth + Search Console sync
src/app/actions.ts          all form actions (approve, push, assign…)
```

## Not in this version (next phases)

- DataForSEO rank tracking and SERP metrics
- URL inspection / indexing status from Search Console
- Email notifications and client-facing reports
- Background queue (Inngest) for pushes. Today a push runs in the request with 3 retries, up to 60 seconds.

## Social Studio (Super Admin only)

Posts for the agency's own social accounts, under **Social** in the Admin menu. Only the Super Admin sees it; every page, action and API route checks the role on the server and other users get a 404.

1. **Projects**: add one per account. Pick the client (its brand profile, colours and logo are used), list the targeted services (ideas only come from these), platforms, posting hours and the Facebook Page / Instagram / LinkedIn company IDs. The AI writes a fact card per service from the website; edit it to add real results or offers.
2. **Generate the whole month**: plans every post at once, Monday to Saturday (never Sunday). Each week gets **1 carousel, 2 Reels and 2 images** (`WEEK_MIX` in `src/lib/social/formats.ts`), and the month is balanced across the content pillars (informative 40%, hidden promo 20%, client/brand journey 20%, promotional 20%) plus up to 4 holiday / event posts on the day itself (the AI lists the month's holidays and events for the client's country). No repeats of the last 120 days or of rejected ideas; days that already have a post are kept. Captions and images are then made one by one while the page is open, and by n8n every 15 minutes.
3. **Review**: pick one of 3 opening lines, edit captions and the image headline, change the date, then Approve. Reject needs a reason ("Reject and make a new one" replaces it right away). "New captions" takes an optional note. Image formats: **Concept** (the default: one striking AI visual metaphor on a flat background with 2-6 words above it, never fake people or offices), **Photo** (a real photo from the project's library with a few words), **Big type**, and **Note** / **List** / **Versus** (only when you switch to them). "Another look" changes fonts and colours for free; "New visual" / "Change photo" take an optional note. **Carousels**: the image is the cover, then 3-5 slides and a closing slide in the same look (edit the slide text on the card). **Reels**: a silent 9:16 MP4 of about 10 seconds, rendered with ffmpeg (`ffmpeg-static`): the post's visual with a slow push-in, its 3 lines of text appearing one by one, then the brand card (edit the lines on the card).
4. **Competitor research** (Projects → project → Competitor research): list competitors' Instagram business accounts. The app reads their last posts (Instagram Business Discovery API, needs `META_ACCESS_TOKEN`), ranks them by engagement, reads our own posts' reach and saves, and the AI writes what they target, what wins, caption patterns, what their best images look like and the gaps we can own. Ideas, captions and image formats learn from it indirectly (never copied, never named). Refreshes itself before a month is planned if older than 2 weeks.
5. **Photo library** (Projects → project → Photo library): upload real photos (team, office, work, result screenshots). The AI describes each one and picks a fitting photo for photo posts.
6. **Learning agent**: every rejection reason, regenerate note and caption edit is stored per project, and the agent rewrites that project's rules (Projects → project → Learning agent). Every new idea, caption and image follows them.
7. **Publishing**: import `n8n/Social-Publisher.json` into n8n, pick the credentials (see the note inside), activate. Approved posts go out at their time; results and links show on the Published tab. Images are served publicly at `/api/social/image/<post id>.jpg` (carousel slides at `<post id>-2.jpg`...) and Reels at `/api/social/video/<post id>.mp4`, so Facebook, Instagram and LinkedIn can fetch them. LinkedIn gets the cover image for carousels and Reels.
