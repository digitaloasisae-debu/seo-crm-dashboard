import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { syncClient } from "@/lib/google";

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
  return NextResponse.json({ synced: done, failed, remaining: clients.length - done.length - failed.length });
}
