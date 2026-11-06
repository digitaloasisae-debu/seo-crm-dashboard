import { NextResponse, type NextRequest } from "next/server";
import { advanceCrawl, pendingCrawls, startDueAudits } from "@/lib/audit-schedule";

export const maxDuration = 300;

/** Daily (Vercel Cron): start monthly audits that are due, and finish/analyse/email ones still pending. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const startedAudits = await startDueAudits();
  const results: Record<string, string> = {};
  for (const c of await pendingCrawls()) {
    if (Date.now() - started > 150_000) break;
    results[c.id] = await advanceCrawl(c.id).catch((e) => `error: ${e instanceof Error ? e.message : e}`);
  }
  return NextResponse.json({ startedAudits, results });
}
