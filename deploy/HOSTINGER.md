# Running Rankflow on the Hostinger VPS

Rankflow runs on the same VPS as n8n (srv1920289.hstgr.cloud, 185.172.57.56), as a Docker container
behind n8n's existing Traefik, so it gets HTTPS automatically. The database stays on Supabase.

**How updates work:** every push to `main` starts the GitHub Action "Deploy to Hostinger VPS".
It builds the Docker image on GitHub (the VPS never builds anything), then logs in to the VPS over SSH,
pulls the new image and restarts the app. It takes about 4–6 minutes and shows in the repo's **Actions** tab.

The three daily jobs Vercel Cron used to run (Search Console sync 05:00, audits 06:00, growth 07:00 UTC)
run in a small `cron` container next to the app.

---

## One-time setup (about 20 minutes)

### 1. Pick the address and point it at the VPS

Choose a subdomain, for example `app.digitaloasis.ae`. Where your domain's DNS is managed, add:

| Type | Name | Value |
|---|---|---|
| A | `app` | `185.172.57.56` |

### 2. Let GitHub log in to the VPS

In Hostinger, open the VPS and click **Web console**. Paste:

```sh
ssh-keygen -t ed25519 -f /root/.ssh/github_deploy -N "" -C github-deploy
cat /root/.ssh/github_deploy.pub >> /root/.ssh/authorized_keys
cat /root/.ssh/github_deploy
```

Copy everything the last command prints (from `-----BEGIN` to `END OPENSSH PRIVATE KEY-----`).
In GitHub, open the repo, then **Settings → Secrets and variables → Actions → New repository secret**, and add:

- `VPS_SSH_KEY`: the key you just copied
- `VPS_HOST`: `185.172.57.56`

### 3. Put the settings on the VPS

Copy every environment variable from Vercel (project **seo-crm-dashboard-geuv → Settings → Environment Variables**)
into a file on the VPS. In the Web console:

```sh
mkdir -p /opt/rankflow && nano /opt/rankflow/.env
```

Paste them one per line as `NAME=value`, then save with Ctrl+O, Enter, Ctrl+X. Then change or check these:

- `APP_URL=https://app.digitaloasis.ae` (your new address from step 1)
- `ENCRYPTION_KEY` **must be exactly the same as in Vercel**, otherwise the saved WordPress logins can't be read.
  If Vercel hides it and you don't have it saved anywhere, the WordPress logins have to be entered again per client.
- `N8N_ALLOWED_IPS=` leave it empty (n8n now talks to the app from inside the same server).
- `DATABASE_URL`, `DIRECT_URL`: the Supabase connection strings (Supabase → Project Settings → Database).

Vercel shows "sensitive" values as hidden. For those, use the original value (Supabase, Google Cloud, Gemini,
DataForSEO, Meta). For random secrets like `AUTH_SECRET` and `CRON_SECRET` you can make new ones
(`openssl rand -base64 32`); a new `AUTH_SECRET` just logs everyone out once.

### 4. Deploy

Merge the pull request, or open **Actions → Deploy to Hostinger VPS → Run workflow**. When it's green, open
`https://app.digitaloasis.ae` and log in. The first visit can take a few seconds while the HTTPS certificate is issued.

If the deploy step fails, its log says why (for example a missing `.env` or `APP_URL`).
On the VPS, `docker logs rankflow-app-1 --tail 50` shows the app's own log.

### 5. Switch everything over to the new address

1. **Google Cloud** (project n8n-seo-blog-automation-506608 → APIs & Services → Credentials → the OAuth client):
   add `https://app.digitaloasis.ae/api/google/callback` to *Authorized redirect URIs*. On the OAuth consent
   screen, change the home page and privacy page to the new address (`/privacy`).
2. **Tally**: in both forms, Integrations → Webhooks, change the URL to
   `https://app.digitaloasis.ae/api/webhooks/tally/onboarding` (onboarding form) and
   `https://app.digitaloasis.ae/api/webhooks/tally/keywords` (keyword form). Keep the same signing secrets.
3. **n8n**: in the Dashboard WF1, WF2 and Social Publisher workflows, replace
   `https://seo-crm-dashboard-geuv.vercel.app` with `https://app.digitaloasis.ae` in every HTTP Request node.
4. Check the Google page in Rankflow still shows both Search Console accounts as connected.

### 6. Turn Vercel off

Once a day has passed with no problems: in Vercel, open **seo-crm-dashboard-geuv → Settings → Git → Disconnect**,
so it stops building and its daily crons stop (otherwise the daily jobs run twice and DataForSEO is charged twice).
Delete the old unused `seo-crm-dashboard` Vercel project too. Keep the -geuv project a few days as a fallback, then delete it.

---

## Everyday

- **Update the app:** push or merge to `main`; GitHub deploys it.
- **Redeploy by hand:** Actions → Deploy to Hostinger VPS → Run workflow, or on the VPS `sh /opt/rankflow/up.sh`.
- **Change a setting:** edit `/opt/rankflow/.env`, then `sh /opt/rankflow/up.sh`.
- **See logs:** `docker logs rankflow-app-1 --tail 100` (app) and `docker logs rankflow-cron-1` (daily jobs).
- **Roll back:** in Actions, re-run the deploy of an older commit.

The VPS is a KVM 2 (2 CPU, 8 GB RAM). Rankflow and n8n together use well under half of it.
Keep the VPS's auto-renewal on.
