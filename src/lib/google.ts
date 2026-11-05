/** Google OAuth + Search Console API, using plain fetch. Refresh tokens are stored encrypted. */
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";

export const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly", GA_SCOPE];

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL);
}

export function redirectUri() {
  return `${(process.env.APP_URL ?? "").replace(/\/+$/, "")}/api/google/callback`;
}

export function authUrl(state: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed: ${j.error_description || j.error || res.status}`);
  return j as { access_token: string; refresh_token?: string; id_token?: string; expires_in: number; scope?: string };
}

/** Finish the OAuth flow: store (or refresh) the connection for this Google account. */
export async function saveConnection(code: string, userId: string) {
  const tok = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
  const email = String(info.email ?? "").toLowerCase();
  if (!email) throw new Error("Google did not return an email address");
  const existing = await db.googleConnection.findUnique({ where: { email } });
  if (!tok.refresh_token && !existing) throw new Error("Google did not return a long-lived token. Remove the app's access at myaccount.google.com/permissions and connect again.");
  const sealed = tok.refresh_token ? encryptSecret(tok.refresh_token) : null;
  return db.googleConnection.upsert({
    where: { email },
    create: { email, refreshEncrypted: sealed!.secretEncrypted, iv: sealed!.iv, keyVersion: sealed!.keyVersion, connectedById: userId, scopes: tok.scope ?? null },
    update: { ...(sealed ? { refreshEncrypted: sealed.secretEncrypted, iv: sealed.iv, keyVersion: sealed.keyVersion } : {}), lastError: null, connectedById: userId, scopes: tok.scope ?? null },
  });
}

const tokenCache = new Map<string, { token: string; exp: number }>();

export async function accessToken(connectionId: string) {
  const hit = tokenCache.get(connectionId);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const conn = await db.googleConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const refresh = decryptSecret({ secretEncrypted: conn.refreshEncrypted, iv: conn.iv, keyVersion: conn.keyVersion });
  try {
    const tok = await tokenRequest({ refresh_token: refresh, grant_type: "refresh_token" });
    tokenCache.set(connectionId, { token: tok.access_token, exp: Date.now() + tok.expires_in * 1000 });
    if (conn.lastError) await db.googleConnection.update({ where: { id: connectionId }, data: { lastError: null } });
    return tok.access_token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.googleConnection.update({ where: { id: connectionId }, data: { lastError: `${msg}. Connect this Google account again.` } });
    throw e;
  }
}

async function gsc<T>(connectionId: string, path: string, body?: unknown): Promise<T> {
  const token = await accessToken(connectionId);
  const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Search Console: ${j.error?.message || res.status}`);
  return j as T;
}

export type GscSite = { siteUrl: string; permissionLevel: string; connectionId: string; email: string };

export async function listSites(): Promise<{ sites: GscSite[]; errors: string[] }> {
  const conns = await db.googleConnection.findMany();
  const sites: GscSite[] = [];
  const errors: string[] = [];
  for (const c of conns) {
    try {
      const j = await gsc<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(c.id, "/sites");
      for (const s of j.siteEntry ?? []) if (s.permissionLevel !== "siteUnverifiedUser") sites.push({ ...s, connectionId: c.id, email: c.email });
    } catch (e) {
      errors.push(`${c.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { sites, errors };
}

export const bareHost = (u: string) => {
  try {
    return new URL(u.startsWith("sc-domain:") ? `https://${u.slice(10)}` : u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** Best Search Console property for a site URL: domain property first, then a URL-prefix property on the same host.
 *  If several connected accounts can see it, prefer the one whose email contains the client's "GSC account" label (e.g. "tom"). */
export function matchSite(siteUrl: string, sites: GscSite[], accountLabel?: string | null) {
  const host = bareHost(siteUrl);
  if (!host) return null;
  const label = (accountLabel ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const score = (s: GscSite) => (label && s.email.toLowerCase().replace(/[^a-z0-9@]/g, "").includes(label) ? 0 : 1);
  const pick = (list: GscSite[]) => list.sort((a, b) => score(a) - score(b))[0] ?? null;
  return pick(sites.filter((s) => s.siteUrl === `sc-domain:${host}`)) ?? pick(sites.filter((s) => !s.siteUrl.startsWith("sc-domain:") && bareHost(s.siteUrl) === host));
}

// ---------- Sync ----------

type Row = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);
const monday = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7));

/** Pull Search Console data for one client: 90 days of daily totals, weekly top queries, top pages (28 days). */
export async function syncClient(clientId: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
  if (!client.gscProperty || !client.gscConnectionId) throw new Error("No Search Console property linked");
  const site = encodeURIComponent(client.gscProperty);
  const q = (body: object) => gsc<{ rows?: Row[] }>(client.gscConnectionId!, `/sites/${site}/searchAnalytics/query`, { dataState: "all", ...body });

  try {
    const today = new Date(`${day(new Date())}T00:00:00Z`);
    const end = addDays(today, -1);

    // Daily totals, last 90 days
    const daily = await q({ startDate: day(addDays(end, -89)), endDate: day(end), dimensions: ["date"], rowLimit: 100 });
    const dailyRows = (daily.rows ?? []).map((r) => ({ clientId, date: new Date(`${r.keys[0]}T00:00:00Z`), clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), position: r.position }));

    // Weekly top queries: 13 weeks on first sync, then the last 3 (recent data still settles).
    const thisMonday = monday(today);
    // Page history arrived later: backfill 13 weeks once for clients synced before it existed.
    const hasPageHistory = client.gscSyncedAt ? (await db.gscPageWeek.count({ where: { clientId } })) > 0 : false;
    const weeks = client.gscSyncedAt && hasPageHistory ? 3 : 13;
    const weekRows: { clientId: string; weekStart: Date; query: string; clicks: number; impressions: number; position: number }[] = [];
    const pageWeekRows: { clientId: string; weekStart: Date; page: string; clicks: number; impressions: number; position: number }[] = [];
    const starts: Date[] = [];
    await Promise.all(
      Array.from({ length: weeks }, async (_, i) => {
        const start = addDays(thisMonday, -7 * i);
        const stop = i === 0 ? end : addDays(start, 6);
        if (stop < start) return;
        starts.push(start);
        const [res, pg] = await Promise.all([
          q({ startDate: day(start), endDate: day(stop), dimensions: ["query"], rowLimit: 250 }),
          q({ startDate: day(start), endDate: day(stop), dimensions: ["page"], rowLimit: 250 }),
        ]);
        for (const r of res.rows ?? []) weekRows.push({ clientId, weekStart: start, query: r.keys[0].slice(0, 300), clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), position: r.position });
        for (const r of pg.rows ?? []) pageWeekRows.push({ clientId, weekStart: start, page: r.keys[0].slice(0, 500), clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), position: r.position });
      }),
    );

    // Top pages, last 28 days
    const pages = await q({ startDate: day(addDays(end, -27)), endDate: day(end), dimensions: ["page"], rowLimit: 100 });
    const pageRows = (pages.rows ?? []).map((r) => ({ clientId, page: r.keys[0].slice(0, 500), clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), position: r.position }));

    await db.$transaction([
      db.gscDaily.deleteMany({ where: { clientId, date: { gte: addDays(end, -89) } } }),
      db.gscDaily.createMany({ data: dailyRows, skipDuplicates: true }),
      db.gscQueryWeek.deleteMany({ where: { clientId, weekStart: { in: starts } } }),
      db.gscQueryWeek.createMany({ data: weekRows, skipDuplicates: true }),
      db.gscQueryWeek.deleteMany({ where: { clientId, weekStart: { lt: addDays(thisMonday, -7 * 52) } } }),
      db.gscPageWeek.deleteMany({ where: { clientId, weekStart: { in: starts } } }),
      db.gscPageWeek.createMany({ data: pageWeekRows, skipDuplicates: true }),
      db.gscPageWeek.deleteMany({ where: { clientId, weekStart: { lt: addDays(thisMonday, -7 * 52) } } }),
      db.gscPage.deleteMany({ where: { clientId } }),
      db.gscPage.createMany({ data: pageRows, skipDuplicates: true }),
      db.client.update({ where: { id: clientId }, data: { gscSyncedAt: new Date(), gscError: null } }),
    ]);
    return { days: dailyRows.length, queries: weekRows.length, pages: pageRows.length, pageWeeks: pageWeekRows.length };
  } catch (e) {
    await db.client.update({ where: { id: clientId }, data: { gscError: e instanceof Error ? e.message : String(e) } });
    throw e;
  }
}
