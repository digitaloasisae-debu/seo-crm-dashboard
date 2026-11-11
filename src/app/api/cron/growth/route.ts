import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { dailyRanks } from "@/lib/rank";
import { findRefreshes } from "@/lib/refresh";
import { dailyGbp } from "@/lib/gbp-content";
import { dataforseoConfigured } from "@/lib/dataforseo";
import { geminiConfigured } from "@/lib/gemini";
import { runContentScore } from "@/lib/serp";

export const maxDuration = 300;

/** Daily (Vercel Cron, after the Search Console sync): rank checks, pages losing clicks, Google profile replies and posts. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const out: Record<string, unknown> = {};
  if (dataforseoConfigured()) out.ranks = await dailyRanks(60_000).catch((e) => `error: ${e instanceof Error ? e.message : e}`);
  const since = new Date(Date.now() - 21 * 864e5);
  const withGsc = await db.gscPageWeek.findMany({ where: { weekStart: { gte: since }, client: { status: "ACTIVE" } }, select: { clientId: true }, distinct: ["clientId"] });
  const refresh: Record<string, number | string> = {};
  for (const c of withGsc) refresh[c.clientId] = await findRefreshes(c.clientId).catch((e) => `error: ${e instanceof Error ? e.message : e}`);
  out.refresh = refresh;
  if (dataforseoConfigured() && geminiConfigured()) out.gbp = await dailyGbp(120_000).catch((e) => `error: ${e instanceof Error ? e.message : e}`);
  // Content score vs Google top 10 for articles that never had one (articles in review first), a few a day.
  if (dataforseoConfigured()) {
    const base = { contentCheckedAt: null, wpBuilder: false, client: { status: "ACTIVE" as const } };
    const review = await db.article.findMany({ where: { ...base, status: "READY_FOR_REVIEW" }, select: { id: true }, take: 15 });
    const rest = review.length < 15 ? await db.article.findMany({ where: { ...base, status: { in: ["APPROVED", "PUSHED_DRAFT", "PUSH_FAILED", "CHANGES_REQUESTED"] } }, select: { id: true }, orderBy: { pushedAt: { sort: "desc", nulls: "last" } }, take: 15 - review.length }) : [];
    let scored = 0;
    for (const a of [...review, ...rest]) {
      if (await runContentScore(a.id).then(() => true, async () => { await db.article.update({ where: { id: a.id }, data: { contentCheckedAt: new Date() } }); return false; })) scored++;
    }
    out.contentScores = scored;
  }
  return NextResponse.json(out);
}
