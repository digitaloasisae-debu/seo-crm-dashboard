import { db } from "./db";
import { normalizeKeyword } from "./utils";

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
  const weeks = await db.gscQueryWeek.findMany({ where: { clientId }, distinct: ["weekStart"], select: { weekStart: true }, orderBy: { weekStart: "desc" }, take: 4 });
  if (!weeks.length) return new Map<string, { position: number; clicks: number; impressions: number }>();
  const rows = await db.gscQueryWeek.findMany({ where: { clientId, weekStart: { in: weeks.map((w) => w.weekStart) } } });
  const map = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = normalizeKeyword(r.query);
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return new Map([...map].map(([k, v]) => [k, weighted(v)]));
}
