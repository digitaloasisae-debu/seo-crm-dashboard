import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { dailyRanks } from "@/lib/rank";
import { findRefreshes } from "@/lib/refresh";
import { dailyGbp } from "@/lib/gbp-content";
import { dataforseoConfigured } from "@/lib/dataforseo";
import { geminiConfigured } from "@/lib/gemini";

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
  return NextResponse.json(out);
}
