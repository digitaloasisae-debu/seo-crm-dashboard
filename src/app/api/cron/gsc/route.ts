import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { syncClient } from "@/lib/google";
import { learnFromRankings } from "@/lib/brain";
import { geminiConfigured } from "@/lib/gemini";
import { pollCrawl } from "@/lib/crawl";

export const maxDuration = 60;

/** Daily (Vercel Cron): refresh Search Console data, oldest first, for as long as the time budget allows. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const clients = await db.client.findMany({
    where: { gscProperty: { not: null }, gscConnectionId: { not: null }, status: "ACTIVE" },
    orderBy: { gscSyncedAt: { sort: "asc", nulls: "first" } },
    select: { id: true, name: true },
  });
  const done: string[] = [];
  const failed: string[] = [];
  for (const c of clients) {
    if (Date.now() - started > 45_000) break;
    try {
      await syncClient(c.id);
      done.push(c.name);
    } catch {
      failed.push(c.name);
    }
  }
  // Weekly: one client's brain learns from its rankings per run, while time allows.
  let learned: string | null = null;
  if (geminiConfigured() && Date.now() - started < 30_000) {
    const due = await db.client.findFirst({
      where: { gscProperty: { not: null }, status: "ACTIVE", OR: [{ brain: null }, { brain: { OR: [{ rankingsLearnedAt: null }, { rankingsLearnedAt: { lt: new Date(Date.now() - 7 * 864e5) } }] } }] },
      orderBy: { gscSyncedAt: "desc" },
      select: { id: true, name: true },
    });
    if (due) {
      const r = await learnFromRankings(due.id).catch((e) => ({ skipped: true, reason: String(e) }));
      learned = `${due.name}: ${r.skipped ? `skipped (${"reason" in r ? r.reason : ""})` : "updated"}`;
      // Don't retry a client with too little data every day.
      if (r.skipped) await db.clientBrain.upsert({ where: { clientId: due.id }, create: { clientId: due.id, rankingsLearnedAt: new Date() }, update: { rankingsLearnedAt: new Date() } });
    }
  }
  // Finish site audits nobody has opened since they started.
  const crawls = await db.siteCrawl.findMany({ where: { status: "RUNNING" }, take: 5 });
  for (const c of crawls) {
    if (Date.now() - started > 50_000) break;
    await pollCrawl(c).catch(() => null);
  }
  return NextResponse.json({ synced: done, failed, learned, remaining: clients.length - done.length - failed.length });
}
