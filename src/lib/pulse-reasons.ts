/**
 * "Why did this client go up or down?" for the Today page client cards.
 * Compares the first 4 weeks of the 12-week window with the last 4 complete weeks,
 * then explains the change from Search Console data and Rankflow activity.
 */
import { db } from "@/lib/db";

const DAY = 864e5;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const monday = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7));

/** Weeks whose Sunday is at least 2 days old (Search Console's last days are still filling in). */
export function pulseWindow(now = new Date()) {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const last = monday(addDays(today, -8)); // newest complete week
  const first = addDays(last, -77); // 12 weeks in total
  return { first, last, beforeEnd: addDays(first, 28), nowFrom: addDays(last, -21) };
}

export type Mover = { label: string; before: number; now: number; posBefore: number | null; posNow: number | null };
export type Reason = { tone: "up" | "down" | "info"; text: string };
export type PulseWhy = { pct: number | null; before: number; now: number; reasons: Reason[]; movers: Mover[] };

type Row = { clientId: string; key: string; before: number; now: number; posBefore: number | null; posNow: number | null; impBefore: number; impNow: number; rn: number };

async function movers(table: "GscPageWeek" | "GscQueryWeek", col: "page" | "query", ids: string[], w: ReturnType<typeof pulseWindow>) {
  if (!ids.length) return [] as Row[];
  // Per page (or search): average clicks per week in each window, impression-weighted position, top 4 by size of change.
  return db.$queryRawUnsafe<Row[]>(
    `WITH s AS (
       SELECT "clientId", "${col}" AS key,
         SUM(CASE WHEN "weekStart" < $2 THEN clicks ELSE 0 END) / 4.0 AS before,
         SUM(CASE WHEN "weekStart" >= $3 THEN clicks ELSE 0 END) / 4.0 AS now,
         SUM(CASE WHEN "weekStart" < $2 THEN impressions ELSE 0 END)::float AS "impBefore",
         SUM(CASE WHEN "weekStart" >= $3 THEN impressions ELSE 0 END)::float AS "impNow",
         SUM(CASE WHEN "weekStart" < $2 THEN position * impressions END) / NULLIF(SUM(CASE WHEN "weekStart" < $2 THEN impressions END), 0) AS "posBefore",
         SUM(CASE WHEN "weekStart" >= $3 THEN position * impressions END) / NULLIF(SUM(CASE WHEN "weekStart" >= $3 THEN impressions END), 0) AS "posNow"
       FROM "${table}"
       WHERE "clientId" = ANY($1) AND "weekStart" >= $4 AND "weekStart" <= $5 AND ("weekStart" < $2 OR "weekStart" >= $3)
       GROUP BY 1, 2
     )
     SELECT *, ROW_NUMBER() OVER (PARTITION BY "clientId" ORDER BY ABS(now - before) DESC) AS rn FROM s WHERE now <> before`,
    ids, w.beforeEnd, w.nowFrom, w.first, w.last,
  ).then((rows) => rows.filter((r) => Number(r.rn) <= 4).map((r) => ({ ...r, before: Number(r.before), now: Number(r.now), impBefore: Number(r.impBefore), impNow: Number(r.impNow) })));
}

const path = (u: string) => {
  try { const p = new URL(u).pathname.replace(/\/$/, ""); return p || "Home page"; } catch { return u; }
};
const n = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString();
const pctOf = (a: number, b: number) => (b ? Math.round((a / b - 1) * 100) : null);

export async function pulseReasons(ids: string[], w = pulseWindow()): Promise<Map<string, PulseWhy>> {
  const [pages, queries, totals, pushed, losing] = await Promise.all([
    movers("GscPageWeek", "page", ids, w),
    movers("GscQueryWeek", "query", ids, w),
    db.$queryRawUnsafe<{ clientId: string; before: number; now: number; impBefore: number; impNow: number; posBefore: number | null; posNow: number | null; nb: number; nn: number }[]>(
      `SELECT "clientId",
         SUM(CASE WHEN "weekStart" < $2 THEN clicks ELSE 0 END) / 4.0 AS before,
         SUM(CASE WHEN "weekStart" >= $3 THEN clicks ELSE 0 END) / 4.0 AS now,
         SUM(CASE WHEN "weekStart" < $2 THEN impressions ELSE 0 END)::float AS "impBefore",
         SUM(CASE WHEN "weekStart" >= $3 THEN impressions ELSE 0 END)::float AS "impNow",
         SUM(CASE WHEN "weekStart" < $2 THEN position * impressions END) / NULLIF(SUM(CASE WHEN "weekStart" < $2 THEN impressions END), 0) AS "posBefore",
         SUM(CASE WHEN "weekStart" >= $3 THEN position * impressions END) / NULLIF(SUM(CASE WHEN "weekStart" >= $3 THEN impressions END), 0) AS "posNow",
         COUNT(DISTINCT CASE WHEN "weekStart" < $2 THEN "weekStart" END)::int AS nb,
         COUNT(DISTINCT CASE WHEN "weekStart" >= $3 THEN "weekStart" END)::int AS nn
       FROM "GscPageWeek" WHERE "clientId" = ANY($1) AND "weekStart" >= $4 AND "weekStart" <= $5 GROUP BY 1`,
      ids, w.beforeEnd, w.nowFrom, w.first, w.last,
    ),
    db.article.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, pushedAt: { gte: w.first } }, _count: true }),
    db.contentRefresh.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, status: { in: ["OPEN", "DRAFTED"] } }, _count: true }),
  ]);

  const out = new Map<string, PulseWhy>();
  for (const t of totals) {
    // Sums were divided by 4; rescale when a window has fewer weeks of data (new site, late Search Console link).
    const kb = t.nb ? 4 / t.nb : 0, kn = t.nn ? 4 / t.nn : 0;
    if (!kb || !kn) continue;
    const before = Number(t.before) * kb, now = Number(t.now) * kn, impB = Number(t.impBefore) * kb, impN = Number(t.impNow) * kn;
    const pct = before ? Math.round((now / before - 1) * 100) : null;
    const up = now >= before;
    const reasons: Reason[] = [];
    const impPct = pctOf(impN, impB);
    const pb = t.posBefore == null ? null : Number(t.posBefore), pn = t.posNow == null ? null : Number(t.posNow);
    const ctrB = impB ? before * 4 / impB : 0, ctrN = impN ? now * 4 / impN : 0;

    // 1. What kind of change: seen less/more, ranking moved, or same visibility with different clicks.
    if (impPct != null && Math.abs(impPct) >= 15) {
      reasons.push({ tone: impPct > 0 ? "up" : "down", text: impPct > 0 ? `Shown in Google ${impPct}% more often (${n(impB / 4)} → ${n(impN / 4)} views a week)` : `Shown in Google ${-impPct}% less often (${n(impB / 4)} → ${n(impN / 4)} views a week)` });
    }
    if (pb != null && pn != null && Math.abs(pn - pb) >= 1) {
      reasons.push({ tone: pn < pb ? "up" : "down", text: pn < pb ? `Ranking improved: average position ${pb.toFixed(1)} → ${pn.toFixed(1)}` : `Ranking slipped: average position ${pb.toFixed(1)} → ${pn.toFixed(1)}` });
    }
    if (ctrB && ctrN && Math.abs(ctrN / ctrB - 1) >= 0.25 && (impPct == null || Math.abs(impPct) < 15)) {
      reasons.push({ tone: ctrN > ctrB ? "up" : "down", text: `Same visibility, ${ctrN > ctrB ? "more" : "fewer"} people clicking (${(ctrB * 100).toFixed(1)}% → ${(ctrN * 100).toFixed(1)}% of views)` });
    }
    // 2. Which searches drove it.
    const qs = queries.filter((q) => q.clientId === t.clientId && (up ? q.now * kn > q.before * kb : q.now * kn < q.before * kb)).slice(0, 2);
    if (qs.length) reasons.push({ tone: up ? "up" : "down", text: `${up ? "Gained" : "Lost"} most on ${qs.map((q) => `"${q.key}"`).join(" and ")}` });
    // 3. Rankflow activity.
    const p = pushed.find((x) => x.clientId === t.clientId)?._count ?? 0;
    if (p) reasons.push({ tone: "info", text: `${p} blog${p === 1 ? "" : "s"} sent to WordPress in these 12 weeks` });
    else if (!up) reasons.push({ tone: "info", text: "No new blogs sent to WordPress in these 12 weeks" });
    const l = losing.find((x) => x.clientId === t.clientId)?._count ?? 0;
    if (l) reasons.push({ tone: "info", text: `${l} page${l === 1 ? " is" : "s are"} on the Traffic recovery list` });
    if (!reasons.length) reasons.push({ tone: "info", text: "Small change, within normal week-to-week ups and downs" });

    const mv = pages.filter((r) => r.clientId === t.clientId).map((r) => ({ ...r, before: r.before * kb, now: r.now * kn }))
      .filter((r) => Math.abs(r.now - r.before) >= 0.5 && (up ? r.now > r.before : r.now < r.before)).slice(0, 3)
      .map((r) => ({ label: path(r.key), before: r.before, now: r.now, posBefore: r.posBefore == null ? null : Number(r.posBefore), posNow: r.posNow == null ? null : Number(r.posNow) }));
    out.set(t.clientId, { pct, before, now, reasons: reasons.slice(0, 4), movers: mv });
  }
  return out;
}
