import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { pingbackToken } from "@/lib/crawl";
import { advanceCrawl } from "@/lib/audit-schedule";

export const maxDuration = 300;

/** DataForSEO calls this when a site crawl has finished: build the issues, run the analysis, email if scheduled. */
async function handle(req: NextRequest) {
  const task = req.nextUrl.searchParams.get("task") ?? "";
  const t = Buffer.from(req.nextUrl.searchParams.get("t") ?? "");
  const want = Buffer.from(pingbackToken());
  if (t.length !== want.length || !timingSafeEqual(t, want)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const crawl = await db.siteCrawl.findFirst({ where: { taskId: task }, select: { id: true } });
  if (!crawl) return NextResponse.json({ ok: true, note: "unknown task" });
  const result = await advanceCrawl(crawl.id).catch((e) => `error: ${e instanceof Error ? e.message : e}`);
  return NextResponse.json({ ok: true, result });
}

export const GET = handle;
export const POST = handle;
