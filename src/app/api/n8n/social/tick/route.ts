import { after, NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { checkN8nAuth } from "@/lib/n8n";
import { carouselUrls, imageUrl, videoUrl } from "@/lib/social/image";
import { socialWork } from "@/lib/social/work";

export const maxDuration = 300;

/**
 * POST /api/n8n/social/tick  (n8n "Social Publisher", every 15 minutes)
 * Returns one item per platform for every approved post that is due, and marks those posts as
 * publishing. Afterwards it keeps making drafts (captions and images) in the background.
 */
export async function POST(req: NextRequest) {
  const denied = checkN8nAuth(req);
  if (denied) return denied;
  // Posts stuck in "publishing" for an hour never got their result back: show them as failed.
  await db.socialPost.updateMany({ where: { status: "PUBLISHING", updatedAt: { lt: new Date(Date.now() - 3600_000) } }, data: { status: "FAILED" } });
  const due = await db.socialPost.findMany({
    where: { status: "APPROVED", stage: "ready", scheduledAt: { lte: new Date() }, project: { active: true } },
    select: { id: true, imageVersion: true, kind: true, captionFacebook: true, captionInstagram: true, captionLinkedin: true, firstComment: true, altText: true, results: true, project: { select: { platforms: true, fbPageId: true, igUserId: true, linkedinOrgId: true, client: { select: { name: true } } } } },
    orderBy: { scheduledAt: "asc" },
    take: 10,
  });
  // Slide counts and whether a Reel exists, without loading the bytes.
  const media = due.length
    ? await db.$queryRaw<{ id: string; slides: number; has_video: boolean }[]>`SELECT id, coalesce(array_length(slides, 1), 0)::int AS slides, video IS NOT NULL AS has_video FROM "SocialPost" WHERE id = ANY(${due.map((p) => p.id)})`
    : [];
  const items = [];
  for (const p of due) {
    const m = media.find((x) => x.id === p.id);
    // What actually gets published: a carousel needs its slides, a Reel its video; otherwise the image.
    const kind = p.kind === "carousel" && m?.slides ? "carousel" : p.kind === "video" && m?.has_video ? "video" : "image";
    const claimed = await db.socialPost.updateMany({ where: { id: p.id, status: "APPROVED" }, data: { status: "PUBLISHING" } });
    if (!claimed.count) continue;
    const done = (p.results ?? {}) as Record<string, { id?: string }>;
    for (const platform of p.project.platforms) {
      if (done[platform]?.id) continue; // already posted there on an earlier try
      const caption = platform === "facebook" ? p.captionFacebook : platform === "instagram" ? p.captionInstagram : p.captionLinkedin;
      items.push({
        post_id: p.id,
        project: p.project.client.name,
        platform,
        caption,
        first_comment: platform === "linkedin" ? p.firstComment : "",
        alt_text: p.altText,
        // LinkedIn always gets the single image (the cover).
        kind: platform === "linkedin" ? "image" : kind,
        image_url: imageUrl(p),
        media_urls: kind === "carousel" ? carouselUrls(p, m?.slides ?? 0) : [],
        video_url: kind === "video" ? videoUrl(p) : "",
        fb_page_id: p.project.fbPageId ?? "",
        ig_user_id: p.project.igUserId ?? "",
        linkedin_org_id: p.project.linkedinOrgId ?? "",
      });
    }
  }
  if (req.nextUrl.searchParams.get("work") !== "0") after(() => socialWork(220_000).catch((e) => console.error("social.work_failed", e)));
  return NextResponse.json({ count: items.length, items });
}
