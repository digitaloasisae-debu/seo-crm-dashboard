/**
 * "Why did this client go up or down?" for the Today page client cards.
 * Compares the last 4 complete weeks with the 4 weeks before them (month on month),
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
  const first = addDays(last, -77); // 12 weeks in total (the chart)
  const nowFrom = addDays(last, -21); // last 4 complete weeks
  const prevFrom = addDays(nowFrom, -28); // the 4 weeks before them
  return { first, last, prevFrom, beforeEnd: nowFrom, nowFrom };
}

const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
/** Plain date ranges for the labels, e.g. "14 Sep – 11 Oct". */
export function pulseLabels(w = pulseWindow()) {
  return {
    prev: `${fmtDay(w.prevFrom)} – ${fmtDay(addDays(w.nowFrom, -1))}`,
    now: `${fmtDay(w.nowFrom)} – ${fmtDay(addDays(w.last, 6))}`,
    chartFrom: fmtDay(w.first),
    chartTo: fmtDay(addDays(w.last, 6)),
  };
}

export type Mover = { label: string; before: number; now: number; posBefore: number | null; posNow: number | null };
export type Metric = { label: string; before: string; now: string; better: boolean | null };
/** Measured numbers only: no interpretation of causes. */
export type Advice = { evidence: string; reason: string; fix: string; href: string };
export type PulseWhy = { pct: number | null; before: number; now: number; metrics: Metric[]; searches: Mover[]; movers: Mover[]; facts: string[]; advice: Advice[] };

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
    ids, w.beforeEnd, w.nowFrom, w.prevFrom, w.last,
  ).then((rows) => rows.filter((r) => Number(r.rn) <= 4).map((r) => ({ ...r, before: Number(r.before), now: Number(r.now), impBefore: Number(r.impBefore), impNow: Number(r.impNow) })));
}

const path = (u: string) => {
  try { const p = new URL(u).pathname.replace(/\/$/, ""); return p || "Home page"; } catch { return u; }
};
const n = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString();

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
      ids, w.beforeEnd, w.nowFrom, w.prevFrom, w.last,
    ),
    db.article.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, pushedAt: { gte: w.first } }, _count: true }),
    db.contentRefresh.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, status: { in: ["OPEN", "DRAFTED"] } }, _count: true }),
  ]);
  const audits = await db.siteAudit.findMany({ where: { clientId: { in: ids }, status: "DONE" }, select: { clientId: true, issues: true, psiMobile: true }, orderBy: { startedAt: "desc" }, distinct: ["clientId"] });

  const out = new Map<string, PulseWhy>();
  for (const t of totals) {
    // Sums were divided by 4; rescale when a window has fewer weeks of data (new site, late Search Console link).
    const kb = t.nb ? 4 / t.nb : 0, kn = t.nn ? 4 / t.nn : 0;
    if (!kb || !kn) continue;
    const before = Number(t.before) * kb, now = Number(t.now) * kn, impB = (Number(t.impBefore) * kb) / 4, impN = (Number(t.impNow) * kn) / 4; // views a week
    const pct = before ? Math.round((now / before - 1) * 100) : null;
    const pb = t.posBefore == null ? null : Number(t.posBefore), pn = t.posNow == null ? null : Number(t.posNow);
    const ctrB = impB ? (before / impB) * 100 : null, ctrN = impN ? (now / impN) * 100 : null;
    const cmp = (a: number | null, b: number | null, higherIsBetter: boolean) => (a == null || b == null || a === b ? null : higherIsBetter ? b > a : b < a);
    const metrics: Metric[] = [
      { label: "Clicks a week", before: n(before), now: n(now), better: cmp(before, now, true) },
      { label: "Google views a week", before: n(impB), now: n(impN), better: cmp(impB, impN, true) },
      { label: "Average position", before: pb == null ? "—" : pb.toFixed(1), now: pn == null ? "—" : pn.toFixed(1), better: cmp(pb && +pb.toFixed(1), pn && +pn.toFixed(1), false) },
      { label: "Click rate", before: ctrB == null ? "—" : `${ctrB.toFixed(1)}%`, now: ctrN == null ? "—" : `${ctrN.toFixed(1)}%`, better: cmp(ctrB && +ctrB.toFixed(1), ctrN && +ctrN.toFixed(1), true) },
    ];
    const searches = queries.filter((q) => q.clientId === t.clientId).map((q) => ({ label: q.key, before: q.before * kb, now: q.now * kn, posBefore: q.posBefore == null ? null : Number(q.posBefore), posNow: q.posNow == null ? null : Number(q.posNow) }))
      .filter((q) => Math.abs(q.now - q.before) >= 0.5).sort((x, y) => Math.abs(y.now - y.before) - Math.abs(x.now - x.before)).slice(0, 3);
    const facts: string[] = [];
    const p = pushed.find((x) => x.clientId === t.clientId)?._count ?? 0;
    facts.push(`${p} blog${p === 1 ? "" : "s"} sent to WordPress in these 12 weeks`);
    const l = losing.find((x) => x.clientId === t.clientId)?._count ?? 0;
    if (l) facts.push(`${l} page${l === 1 ? " is" : "s are"} on the Traffic recovery list`);
    const mv = pages.filter((r) => r.clientId === t.clientId).map((r) => ({ ...r, before: r.before * kb, now: r.now * kn }))
      .filter((r) => Math.abs(r.now - r.before) >= 0.5).sort((x, y) => Math.abs(y.now - y.before) - Math.abs(x.now - x.before)).slice(0, 3)
      .map((r) => ({ label: path(r.key), before: r.before, now: r.now, posBefore: r.posBefore == null ? null : Number(r.posBefore), posNow: r.posNow == null ? null : Number(r.posNow) }));
    // Likely reasons and fixes: each rule fires only on a measured number and names it.
    const c = `/clients/${t.clientId}`;
    const advice: Advice[] = [];
    const posDrop = pb != null && pn != null ? pn - pb : 0;
    const viewsPct = impB ? (impN / impB - 1) * 100 : 0;
    const worstPage = mv.find((m) => m.now < m.before);
    if (posDrop >= 1) advice.push({ evidence: `Average position ${pb!.toFixed(1)} → ${pn!.toFixed(1)}`, reason: "The site's pages rank lower than before, so fewer people see and click them.", fix: "Update the pages that slipped with fresher, deeper content and add internal links to them.", href: `${c}/refresh` });
    if (viewsPct <= -15 && Math.abs(posDrop) < 1) advice.push({ evidence: `Views ${Math.round(viewsPct)}% while average position held`, reason: "Rankings held but Google showed the site less, which usually means fewer people searched these terms (often seasonal).", fix: "Cover more searches: add and approve new keywords and topics.", href: `${c}/keywords` });
    if (ctrB != null && ctrN != null && ctrN < ctrB * 0.8 && Math.abs(posDrop) < 1) advice.push({ evidence: `Click rate ${ctrB.toFixed(1)}% → ${ctrN.toFixed(1)}% at a similar position`, reason: "People see the result but click it less. Usually the title or description is less appealing than competitors', or Google added ads or maps above it.", fix: "Rewrite the meta titles and descriptions of the pages below to be more specific and clickable.", href: `${c}/articles` });
    if (worstPage && worstPage.before - worstPage.now >= 2) advice.push({ evidence: `${worstPage.label}: ${n(worstPage.before)} → ${n(worstPage.now)} clicks a week${worstPage.posBefore != null && worstPage.posNow != null ? `, position ${worstPage.posBefore.toFixed(0)} → ${worstPage.posNow.toFixed(0)}` : ""}`, reason: "This one page accounts for a large part of the change.", fix: "Plan an update for this page in Traffic recovery.", href: `${c}/refresh` });
    if (!p && now < before) advice.push({ evidence: "0 blogs sent to WordPress in 12 weeks", reason: "No new pages were added to rank for new searches.", fix: "Approve topics so n8n writes and sends new blogs.", href: `${c}/topics` });
    const a = audits.find((x) => x.clientId === t.clientId);
    const errs = ((a?.issues as { severity?: string; count?: number }[] | null) ?? []).filter((i) => i.severity === "error");
    if (errs.length && now < before) advice.push({ evidence: `${errs.length} error${errs.length === 1 ? "" : "s"} in the last SEO audit`, reason: "Technical errors can stop Google from showing or ranking pages.", fix: "Fix the errors listed in the SEO audit.", href: `${c}/seo` });
    const perf = (a?.psiMobile as { performance?: number } | null)?.performance;
    if (perf != null && perf < 50 && now < before) advice.push({ evidence: `Mobile speed score ${Math.round(perf)} of 100`, reason: "Slow pages on phones rank and convert worse.", fix: "Compress images and remove heavy scripts, then rerun the SEO audit.", href: `${c}/seo` });
    out.set(t.clientId, { pct, before, now, metrics, searches, movers: mv, facts, advice: advice.slice(0, 3) });
  }
  return out;
}
