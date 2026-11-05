/**
 * Google Analytics 4: traffic and key events (conversions) per client, via the GA4 Admin API (to find
 * properties) and Data API (reports). Uses the same Google connections as Search Console.
 */
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { accessToken, bareHost, GA_SCOPE } from "./google";

export type Ga4Property = { id: string; name: string; account: string; connectionId: string; email: string; hosts: string[] };
export type Ga4Totals = { sessions: number; users: number; newUsers: number; keyEvents: number; engagementRate: number; views: number };
export type Ga4Row = { name: string; sessions: number; users: number; keyEvents: number; engagementRate?: number };
export type Ga4Data = {
  days: number;
  current: Ga4Totals;
  previous: Ga4Totals;
  daily: { date: string; sessions: number; keyEvents: number }[];
  channels: Ga4Row[];
  pages: Ga4Row[];
  organicPages: Ga4Row[];
  events: { name: string; count: number }[];
};

const DAYS = 28;

function friendly(api: "Admin" | "Data", status: number, msg: string) {
  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg)) return "This Google account was connected before Analytics was added. Connect it again on the Google page.";
  if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(msg)) return `Turn on the "Google Analytics ${api} API" in Google Cloud (APIs & Services → Library), then try again.`;
  if (status === 403) return `No access to this Analytics property: ${msg}`;
  return `Google Analytics: ${msg || status}`;
}

async function gaFetch<T>(api: "Admin" | "Data", connectionId: string, url: string, body?: unknown): Promise<T> {
  const token = await accessToken(connectionId);
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendly(api, res.status, j.error?.message ?? ""));
  return j as T;
}

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";

/** Every GA4 property the connected Google accounts can see, with the website(s) each one tracks. */
export async function listGa4Properties(): Promise<{ properties: Ga4Property[]; errors: string[] }> {
  const conns = await db.googleConnection.findMany();
  const properties: Ga4Property[] = [];
  const errors: string[] = [];
  for (const c of conns) {
    if (c.scopes && !c.scopes.includes(GA_SCOPE)) {
      errors.push(`${c.email}: connected before Analytics was added. Connect it again to see its Analytics properties.`);
      continue;
    }
    try {
      const found: Ga4Property[] = [];
      let pageToken = "";
      for (let i = 0; i < 10; i++) {
        type Summaries = { accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[]; nextPageToken?: string };
        const j = await gaFetch<Summaries>("Admin", c.id, `${ADMIN}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`);
        for (const a of j.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) {
          found.push({ id: p.property.replace("properties/", ""), name: p.displayName, account: a.displayName, connectionId: c.id, email: c.email, hosts: [] });
        }
        if (!j.nextPageToken) break;
        pageToken = encodeURIComponent(j.nextPageToken);
      }
      // Which website each property tracks (for auto-matching), a few at a time.
      for (let i = 0; i < found.length; i += 8) {
        await Promise.all(found.slice(i, i + 8).map(async (p) => {
          try {
            const s = await gaFetch<{ dataStreams?: { webStreamData?: { defaultUri?: string } }[] }>("Admin", c.id, `${ADMIN}/properties/${p.id}/dataStreams`);
            p.hosts = (s.dataStreams ?? []).map((d) => bareHost(d.webStreamData?.defaultUri ?? "")).filter(Boolean);
          } catch {
            // Not fatal: the property can still be picked by hand.
          }
        }));
      }
      properties.push(...found);
    } catch (e) {
      errors.push(`${c.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { properties, errors };
}

/** The property whose web stream is this client's website (prefers the client's GSC account if there are several). */
export function matchGa4(siteUrl: string, props: Ga4Property[], preferConnectionId?: string | null) {
  const host = bareHost(siteUrl);
  if (!host) return null;
  const hits = props.filter((p) => p.hosts.includes(host));
  return hits.find((p) => p.connectionId === preferConnectionId) ?? hits[0] ?? null;
}

/** Links every unlinked client to its matching GA4 property. Returns how many were linked. */
export async function autoMatchGa4(props?: Ga4Property[]) {
  const list = props ?? (await listGa4Properties()).properties;
  const clients = await db.client.findMany({ where: { ga4PropertyId: null }, select: { id: true, siteUrl: true, gscConnectionId: true } });
  let linked = 0;
  for (const c of clients) {
    const m = matchGa4(c.siteUrl, list, c.gscConnectionId);
    if (!m) continue;
    await db.client.update({ where: { id: c.id }, data: { ga4PropertyId: m.id, ga4PropertyName: m.name, ga4ConnectionId: m.connectionId, ga4Error: null } });
    linked++;
  }
  return linked;
}

// ---------- Reports ----------

type Report = { dimensionHeaders?: { name: string }[]; rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] };
const num = (v?: { value: string }) => Number(v?.value ?? 0) || 0;
const range = { startDate: `${DAYS}daysAgo`, endDate: "yesterday" };
const M = (...names: string[]) => names.map((name) => ({ name }));
const bySessions = [{ metric: { metricName: "sessions" }, desc: true }];
const ORGANIC = { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { value: "Organic Search" } } };

function totals(rows: Report["rows"], label: string): Ga4Totals {
  const r = rows?.find((x) => x.dimensionValues?.some((d) => d.value === label));
  const m = r?.metricValues ?? [];
  return { sessions: num(m[0]), users: num(m[1]), newUsers: num(m[2]), keyEvents: num(m[3]), engagementRate: num(m[4]), views: num(m[5]) };
}
const rowsOf = (r: Report | undefined, withEngagement = false): Ga4Row[] =>
  (r?.rows ?? []).map((x) => ({
    name: x.dimensionValues?.[0]?.value ?? "",
    sessions: num(x.metricValues?.[0]), users: num(x.metricValues?.[1]), keyEvents: num(x.metricValues?.[2]),
    ...(withEngagement ? { engagementRate: num(x.metricValues?.[3]) } : {}),
  }));

/** Pull the last 28 days (and the 28 before) for one client and save the snapshot. */
/** Finds a connected Google account that can still see this property (after an account was reconnected). */
async function relinkConnection(clientId: string, propertyId: string) {
  const { properties } = await listGa4Properties();
  const p = properties.find((x) => x.id === propertyId);
  if (!p) return null;
  await db.client.update({ where: { id: clientId }, data: { ga4ConnectionId: p.connectionId, ga4PropertyName: p.name } });
  return p.connectionId;
}

export async function syncAnalytics(clientId: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { ga4PropertyId: true, ga4ConnectionId: true } });
  if (!client.ga4PropertyId) throw new Error("No Analytics property linked");
  const conn = client.ga4ConnectionId ? await db.googleConnection.findUnique({ where: { id: client.ga4ConnectionId }, select: { id: true } }) : null;
  if (!conn) {
    client.ga4ConnectionId = await relinkConnection(clientId, client.ga4PropertyId);
    if (!client.ga4ConnectionId) {
      const msg = "None of the connected Google accounts can see this Analytics property. On the Google page, connect the account that owns it, or pick another property.";
      await db.client.update({ where: { id: clientId }, data: { ga4Error: msg } });
      throw new Error(msg);
    }
  }
  const connectionId = client.ga4ConnectionId!;
  const prop = `${DATA}/properties/${client.ga4PropertyId}`;
  try {
    const [batch, ev] = await Promise.all([
      gaFetch<{ reports?: Report[] }>("Data", connectionId, `${prop}:batchRunReports`, {
        requests: [
          { dateRanges: [{ ...range, name: "current" }, { startDate: `${DAYS * 2}daysAgo`, endDate: `${DAYS + 1}daysAgo`, name: "previous" }], metrics: M("sessions", "totalUsers", "newUsers", "keyEvents", "engagementRate", "screenPageViews") },
          { dateRanges: [{ startDate: "90daysAgo", endDate: "yesterday" }], dimensions: [{ name: "date" }], metrics: M("sessions", "keyEvents"), orderBys: [{ dimension: { dimensionName: "date" } }], limit: 100 },
          { dateRanges: [range], dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: M("sessions", "totalUsers", "keyEvents"), orderBys: bySessions, limit: 12 },
          { dateRanges: [range], dimensions: [{ name: "landingPage" }], metrics: M("sessions", "totalUsers", "keyEvents", "engagementRate"), orderBys: bySessions, limit: 50 },
          { dateRanges: [range], dimensions: [{ name: "landingPage" }], metrics: M("sessions", "totalUsers", "keyEvents", "engagementRate"), dimensionFilter: ORGANIC, orderBys: bySessions, limit: 500 },
        ],
      }),
      gaFetch<Report>("Data", connectionId, `${prop}:runReport`, {
        dateRanges: [range], dimensions: [{ name: "eventName" }], metrics: M("keyEvents"),
        metricFilter: { filter: { fieldName: "keyEvents", numericFilter: { operation: "GREATER_THAN", value: { int64Value: "0" } } } },
        orderBys: [{ metric: { metricName: "keyEvents" }, desc: true }], limit: 15,
      }),
    ]);
    const [tot, daily, channels, pages, organic] = batch.reports ?? [];
    const data: Ga4Data = {
      days: DAYS,
      current: totals(tot?.rows, "current"),
      previous: totals(tot?.rows, "previous"),
      daily: (daily?.rows ?? []).map((r) => {
        const d = r.dimensionValues?.[0]?.value ?? "";
        return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, sessions: num(r.metricValues?.[0]), keyEvents: num(r.metricValues?.[1]) };
      }),
      channels: rowsOf(channels),
      pages: rowsOf(pages, true),
      organicPages: rowsOf(organic, true),
      events: (ev.rows ?? []).map((r) => ({ name: r.dimensionValues?.[0]?.value ?? "", count: num(r.metricValues?.[0]) })),
    };
    await db.$transaction([
      db.analyticsSnapshot.upsert({ where: { clientId }, create: { clientId, data: data as unknown as Prisma.InputJsonValue }, update: { data: data as unknown as Prisma.InputJsonValue, fetchedAt: new Date() } }),
      db.client.update({ where: { id: clientId }, data: { ga4SyncedAt: new Date(), ga4Error: null } }),
    ]);
    return data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.client.update({ where: { id: clientId }, data: { ga4Error: msg } });
    throw e;
  }
}

/** GA4 organic-search numbers for one article's page (matched by URL slug). */
export function articleTraffic(data: Ga4Data | null | undefined, slug: string | null) {
  if (!data || !slug) return null;
  const s = slug.toLowerCase();
  const rows = data.organicPages.filter((p) => p.name.toLowerCase().split("?")[0].replace(/\/+$/, "").split("/").pop() === s);
  if (!rows.length) return null;
  return rows.reduce((a, r) => ({ sessions: a.sessions + r.sessions, users: a.users + r.users, keyEvents: a.keyEvents + r.keyEvents }), { sessions: 0, users: 0, keyEvents: 0 });
}
