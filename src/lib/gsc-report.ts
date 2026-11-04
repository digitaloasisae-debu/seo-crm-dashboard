import { db } from "./db";
import { normalizeKeyword, slugify } from "./utils";

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);

export type QueryPerf = { query: string; clicks: number; impressions: number; ctr: number; position: number; prevPosition: number | null; prevClicks: number; inPool: boolean };

function weighted(rows: { clicks: number; impressions: number; position: number }[]) {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const position = impressions ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions : rows.length ? rows.reduce((s, r) => s + r.position, 0) / rows.length : 0;
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}

/** Search performance for a client: last 28 days vs the 28 before, plus queries over the last 4 weeks vs the 4 before. */
export async function searchPerformance(clientId: string) {
  const daily = await db.gscDaily.findMany({ where: { clientId }, orderBy: { date: "asc" } });
  const last = daily.at(-1)?.date;
  const cur = last ? daily.filter((d) => d.date > addDays(last, -28)) : [];
  const prev = last ? daily.filter((d) => d.date <= addDays(last, -28) && d.date > addDays(last, -56)) : [];

  const weeks = await db.gscQueryWeek.findMany({ where: { clientId }, distinct: ["weekStart"], select: { weekStart: true }, orderBy: { weekStart: "desc" }, take: 8 });
  const recent = weeks.slice(0, 4).map((w) => w.weekStart);
  const before = weeks.slice(4, 8).map((w) => w.weekStart);
  const rows = await db.gscQueryWeek.findMany({ where: { clientId, weekStart: { in: [...recent, ...before] } } });
  const pool = new Set((await db.keyword.findMany({ where: { clientId }, select: { keywordNorm: true } })).map((k) => k.keywordNorm));

  const byQuery = new Map<string, { cur: typeof rows; prev: typeof rows }>();
  for (const r of rows) {
    const e = byQuery.get(r.query) ?? { cur: [], prev: [] };
    (recent.some((w) => +w === +r.weekStart) ? e.cur : e.prev).push(r);
    byQuery.set(r.query, e);
  }
  const queries: QueryPerf[] = [...byQuery]
    .filter(([, v]) => v.cur.length)
    .map(([query, v]) => {
      const c = weighted(v.cur);
      const p = v.prev.length ? weighted(v.prev) : null;
      return { query, ...c, prevPosition: p?.position ?? null, prevClicks: p?.clicks ?? 0, inPool: pool.has(normalizeKeyword(query)) };
    })
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  const pages = await db.gscPage.findMany({ where: { clientId }, orderBy: [{ clicks: "desc" }, { impressions: "desc" }], take: 25 });
  return { daily, totals: weighted(cur), prevTotals: prev.length ? weighted(prev) : null, queries, pages };
}

/** Position and clicks for each keyword in the pool (last 4 synced weeks). */
export async function keywordPositions(clientId: string) {
  const weeks = await db.gscQueryWeek.findMany({ where: { clientId }, distinct: ["weekStart"], select: { weekStart: true }, orderBy: { weekStart: "desc" }, take: 8 });
  type Pos = { position: number; clicks: number; impressions: number; prevPosition: number | null };
  if (!weeks.length) return new Map<string, Pos>();
  const recent = new Set(weeks.slice(0, 4).map((w) => +w.weekStart));
  const rows = await db.gscQueryWeek.findMany({ where: { clientId, weekStart: { in: weeks.map((w) => w.weekStart) } } });
  const map = new Map<string, { cur: typeof rows; prev: typeof rows }>();
  for (const r of rows) {
    const k = normalizeKeyword(r.query);
    const e = map.get(k) ?? { cur: [], prev: [] };
    (recent.has(+r.weekStart) ? e.cur : e.prev).push(r);
    map.set(k, e);
  }
  return new Map<string, Pos>(
    [...map].filter(([, v]) => v.cur.length).map(([k, v]) => [k, { ...weighted(v.cur), prevPosition: v.prev.length ? weighted(v.prev).position : null }]),
  );
}

export type WeekPoint = { week: Date; position: number; clicks: number; impressions: number };

function series(rows: { weekStart: Date; clicks: number; impressions: number; position: number }[]): WeekPoint[] {
  const byWeek = new Map<number, typeof rows>();
  for (const r of rows) byWeek.set(+r.weekStart, [...(byWeek.get(+r.weekStart) ?? []), r]);
  return [...byWeek].sort((a, b) => a[0] - b[0]).map(([w, v]) => ({ week: new Date(w), ...weighted(v) }));
}

/** Queries that climbed or dropped the most (last 4 weeks vs the 4 before), with a 12-week position trend. */
export async function movers(clientId: string, queries: QueryPerf[]) {
  const moved = queries
    .filter((q) => q.prevPosition != null && q.impressions >= 10)
    .map((q) => ({ ...q, change: q.prevPosition! - q.position }))
    .filter((q) => Math.abs(q.change) >= 1);
  const up = [...moved].sort((a, b) => b.change - a.change).filter((q) => q.change > 0).slice(0, 6);
  const down = [...moved].sort((a, b) => a.change - b.change).filter((q) => q.change < 0).slice(0, 6);
  const names = [...up, ...down].map((q) => q.query);
  const weeks = await db.gscQueryWeek.findMany({ where: { clientId }, distinct: ["weekStart"], select: { weekStart: true }, orderBy: { weekStart: "desc" }, take: 12 });
  const rows = names.length ? await db.gscQueryWeek.findMany({ where: { clientId, query: { in: names }, weekStart: { in: weeks.map((w) => w.weekStart) } } }) : [];
  const trend = (q: string) => series(rows.filter((r) => r.query === q));
  return { up: up.map((q) => ({ ...q, trend: trend(q.query) })), down: down.map((q) => ({ ...q, trend: trend(q.query) })) };
}

/** "/my-post/" style path for matching an article slug to Search Console page URLs. */
const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

type ArticleKey = { slug: string; metaTitle: string; focusKeyword: string };

/**
 * Finds the page slug Google knows for an article. WordPress (or Yoast) often uses a different slug than ours,
 * so try our slug, the title, the focus keyword, then any page whose URL holds every word of the focus keyword.
 */
export function matchArticleSlug(a: ArticleKey, pageSlugs: Iterable<string>): string | null {
  const pages = [...pageSlugs];
  const set = new Set(pages);
  for (const c of [a.slug, slugify(a.metaTitle), slugify(a.focusKeyword)].map((x) => x.toLowerCase()).filter(Boolean)) if (set.has(c)) return c;
  const words = slugify(a.focusKeyword).split("-").filter((w) => w.length > 2);
  if (words.length < 2) return null;
  const hits = pages.filter((p) => { const parts = new Set(p.split("-")); return words.every((w) => parts.has(w)); });
  return hits.sort((x, y) => x.length - y.length)[0] ?? null;
}

/** Weekly ranking history for one article. */
export async function articleHistory(clientId: string, article: ArticleKey) {
  const rows = await db.gscPageWeek.findMany({ where: { clientId } });
  const slugOf = (page: string) => pathOf(page).split("/").pop() ?? "";
  const match = matchArticleSlug(article, new Set(rows.map((r) => slugOf(r.page)).filter(Boolean)));
  return match ? series(rows.filter((r) => slugOf(r.page) === match)) : [];
}

/** Position over the last 4 synced weeks (and the 4 before) for every article slug of a client. */
export async function articleRanks(clientId: string) {
  const weeks = await db.gscPageWeek.findMany({ where: { clientId }, distinct: ["weekStart"], select: { weekStart: true }, orderBy: { weekStart: "desc" }, take: 8 });
  const out = new Map<string, { position: number; clicks: number; impressions: number; prevPosition: number | null }>();
  if (!weeks.length) return out;
  const recent = new Set(weeks.slice(0, 4).map((w) => +w.weekStart));
  const rows = await db.gscPageWeek.findMany({ where: { clientId, weekStart: { in: weeks.map((w) => w.weekStart) } } });
  const bySlug = new Map<string, { cur: typeof rows; prev: typeof rows }>();
  for (const r of rows) {
    const slug = pathOf(r.page).split("/").pop() ?? "";
    if (!slug) continue;
    const e = bySlug.get(slug) ?? { cur: [], prev: [] };
    (recent.has(+r.weekStart) ? e.cur : e.prev).push(r);
    bySlug.set(slug, e);
  }
  for (const [slug, v] of bySlug) {
    if (!v.cur.length) continue;
    const c = weighted(v.cur);
    out.set(slug, { position: c.position, clicks: c.clicks, impressions: c.impressions, prevPosition: v.prev.length ? weighted(v.prev).position : null });
  }
  return out;
}
