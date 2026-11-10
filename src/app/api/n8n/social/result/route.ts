import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { checkN8nAuth } from "@/lib/n8n";

type Result = { id?: string; url?: string; error?: string; at?: string };

/**
 * POST /api/n8n/social/result  { post_id, platform, id?, url?, error? }
 * n8n reports each platform. When every platform of the post has reported, the post becomes
 * PUBLISHED (all worked) or FAILED (approve it again to retry the platforms that failed).
 */
export async function POST(req: NextRequest) {
  const denied = checkN8nAuth(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const postId = String(b.post_id ?? "");
  const platform = String(b.platform ?? "");
  if (!postId || !["facebook", "instagram", "linkedin"].includes(platform)) return NextResponse.json({ error: "post_id and platform are required" }, { status: 400 });
  const str = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v)).trim();
  const r: Result = { at: new Date().toISOString() };
  const id = str(b.id);
  const err = str(b.error);
  if (id && !err) r.id = id.slice(0, 200);
  if (str(b.url)) r.url = str(b.url).slice(0, 500);
  if (err || !id) r.error = (err || "No post id came back").slice(0, 400);

  const out = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ results: Prisma.JsonValue }[]>`SELECT results FROM "SocialPost" WHERE id = ${postId} FOR UPDATE`;
    if (!rows.length) return null;
    const post = await tx.socialPost.findUniqueOrThrow({ where: { id: postId }, select: { project: { select: { platforms: true } } } });
    const results = { ...((rows[0].results ?? {}) as Record<string, Result>), [platform]: r };
    const reported = post.project.platforms.every((p) => results[p]);
    const anyOk = Object.values(results).some((x) => x.id);
    const allOk = post.project.platforms.every((p) => results[p]?.id);
    const status = !reported ? undefined : allOk ? "PUBLISHED" : "FAILED"; // FAILED keeps the ids, so a retry only redoes the missing platforms
    await tx.socialPost.update({
      where: { id: postId },
      data: { results: results as Prisma.InputJsonValue, ...(status ? { status, ...(anyOk ? { publishedAt: new Date() } : {}) } : {}) },
    });
    return { status: status ?? "PUBLISHING", results };
  });
  if (!out) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  return NextResponse.json(out);
}
