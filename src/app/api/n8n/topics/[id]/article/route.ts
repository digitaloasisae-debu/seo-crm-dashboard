import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { toSafeHtml } from "@/lib/content";
import { checkN8nAuth } from "@/lib/n8n";
import { slugify } from "@/lib/utils";

const Body = z
  .object({
    meta_title: z.string().min(1),
    meta_description: z.string().optional().default(""),
    url_slug: z.string().optional().default(""),
    content_html: z.string().optional(),
    content_markdown: z.string().optional(),
    featured_image_url: z.string().url().optional(),
  })
  .refine((b) => b.content_html || b.content_markdown, { message: "content_html or content_markdown is required" });

// POST /api/n8n/topics/{id}/article
// Replaces "Build WP Payload" + the WordPress HTTP Request + "Mark Topic Row as Drafted" in WF2.
// The article waits in the dashboard for review; the dashboard pushes it to WordPress after approval.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkN8nAuth(req);
  if (denied) return denied;
  const { id: topicId } = await params;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  const topic = await db.topic.findUnique({ where: { id: topicId }, include: { article: true } });
  if (!topic) return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  if (topic.article && !["GENERATING", "CHANGES_REQUESTED", "READY_FOR_REVIEW"].includes(topic.article.status)) {
    return NextResponse.json({ error: `Article already ${topic.article.status}` }, { status: 409 });
  }

  const data = {
    metaTitle: b.meta_title,
    metaDescription: b.meta_description,
    slug: slugify(b.url_slug || b.meta_title),
    focusKeyword: topic.keyword,
    bodyHtml: toSafeHtml({ html: b.content_html, markdown: b.content_markdown }),
    featuredImageUrl: b.featured_image_url,
    status: "READY_FOR_REVIEW" as const,
  };
  const article = await db.article.upsert({
    where: { topicId },
    create: { ...data, topicId, clientId: topic.clientId },
    update: data,
  });
  await logActivity({ actorTag: "n8n", clientId: topic.clientId, action: "article.ready", entity: "article", entityId: article.id });

  const url = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}/articles/${article.id}` : undefined;
  return NextResponse.json({ article_id: article.id, status: article.status, review_url: url });
}
