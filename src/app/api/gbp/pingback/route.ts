import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { pingbackToken } from "@/lib/crawl";
import { collectReviews } from "@/lib/gbp-content";

export const maxDuration = 60;

/** DataForSEO calls this when Google reviews are ready. */
async function handle(req: NextRequest) {
  const t = Buffer.from(req.nextUrl.searchParams.get("t") ?? "");
  const want = Buffer.from(pingbackToken());
  if (t.length !== want.length || !timingSafeEqual(t, want)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ ok: true });
  const done = await collectReviews(id).catch((e) => `error: ${e instanceof Error ? e.message : e}`);
  return NextResponse.json({ ok: true, done });
}

export const GET = handle;
export const POST = handle;
