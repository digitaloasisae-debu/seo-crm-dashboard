import type { ClientCredential } from "@prisma/client";
import { db } from "./db";
import { decryptSecret } from "./crypto";
import { logActivity } from "./activity";
import { nextOpenSlot } from "./posting";

const MAX_ATTEMPTS = 3;

function authHeader(cred: ClientCredential): string {
  const password = decryptSecret(cred);
  return "Basic " + Buffer.from(`${cred.username}:${password}`).toString("base64");
}

/** https://site.com/wp-json/wp/v2/posts -> https://site.com/wp-json/wp/v2 */
function apiBase(endpoint: string): string {
  return endpoint.replace(/\/+$/, "").replace(/\/posts$/, "");
}

export async function wpFetch(cred: ClientCredential, path: string, init: RequestInit = {}) {
  const res = await fetch(`${apiBase(cred.endpoint)}${path}`, {
    ...init,
    headers: { Authorization: authHeader(cred), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const msg = (body as { message?: string })?.message || text.slice(0, 300);
    throw new Error(`WordPress ${res.status}: ${msg}`);
  }
  return body as Record<string, unknown>;
}

export async function testConnection(clientId: string) {
  const cred = await db.clientCredential.findUnique({ where: { clientId_kind: { clientId, kind: "WORDPRESS" } } });
  if (!cred) throw new Error("No WordPress credentials saved for this client");
  try {
    const me = await wpFetch(cred, "/users/me?context=edit");
    await db.clientCredential.update({ where: { id: cred.id }, data: { lastVerifiedAt: new Date(), lastError: null } });
    return { ok: true as const, user: String(me.name ?? me.slug ?? cred.username) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.clientCredential.update({ where: { id: cred.id }, data: { lastError: msg } });
    return { ok: false as const, error: msg };
  }
}

async function uploadFeaturedImage(cred: ClientCredential, imageUrl: string, slug: string): Promise<number> {
  const img = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
  if (!img.ok) throw new Error(`Could not download featured image (${img.status})`);
  const type = img.headers.get("content-type") || "image/png";
  const ext = type.split("/")[1]?.split(";")[0] || "png";
  const media = await wpFetch(cred, "/media", {
    method: "POST",
    headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${slug || "featured"}.${ext}"` },
    body: Buffer.from(await img.arrayBuffer()),
  });
  return Number(media.id);
}

/**
 * Push an APPROVED article to WordPress as a draft, with the same payload WF2 used
 * (title, content, slug, excerpt, Rank Math meta). Retries up to 3 times.
 */
export async function pushArticle(articleId: string, actorId?: string) {
  const article = await db.article.findUniqueOrThrow({ where: { id: articleId } });
  if (article.wpBuilder) throw new Error("This page is built with a page builder. Edit it in WordPress instead.");
  if (!["APPROVED", "PUSH_FAILED"].includes(article.status)) {
    throw new Error(`Article must be approved before pushing (status is ${article.status})`);
  }
  const cred = await db.clientCredential.findUnique({
    where: { clientId_kind: { clientId: article.clientId, kind: "WORDPRESS" } },
  });
  if (!cred) throw new Error("No WordPress credentials saved for this client");

  await db.article.update({ where: { id: articleId }, data: { status: "PUSHING" } });

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      let mediaId = article.wpMediaId;
      if (!mediaId && article.featuredImageUrl) {
        mediaId = await uploadFeaturedImage(cred, article.featuredImageUrl, article.slug);
        await db.article.update({ where: { id: articleId }, data: { wpMediaId: mediaId } });
      }

      const slot = article.wpPostId ? null : await nextOpenSlot(article.clientId);
      const payload: Record<string, unknown> = {
        // Imported posts keep their own headline; the SEO title goes into Rank Math.
        title: article.wpTitle ?? article.metaTitle,
        content: article.bodyHtml,
        // New posts go in as drafts; an update (e.g. a content refresh) keeps the post's current status.
        ...(article.wpPostId ? {} : { status: "draft" }),
        slug: article.slug,
        excerpt: article.metaDescription ?? "",
        meta: {
          rank_math_focus_keyword: article.focusKeyword,
          rank_math_title: article.metaTitle,
          rank_math_description: article.metaDescription ?? "",
        },
      };
      if (mediaId) payload.featured_media = mediaId;
      if (slot) payload.date = `${slot.scheduledDate.toISOString().slice(0, 10)}T09:00:00`;

      // Update the existing draft if an earlier attempt already created it.
      const coll = article.wpType === "page" ? "pages" : "posts";
      const post = await wpFetch(cred, article.wpPostId ? `/${coll}/${article.wpPostId}` : "/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const updated = await db.$transaction(async (tx) => {
        const a = await tx.article.update({
          where: { id: articleId },
          data: {
            status: "PUSHED_DRAFT",
            wpPostId: Number(post.id),
            wpPostUrl: String(post.link ?? ""),
            pushedAt: new Date(),
            pushAttempts: { increment: attempt },
            lastPushError: null,
          },
        });
        if (slot) await tx.postingSlot.update({ where: { id: slot.id }, data: { articleId } });
        await logActivity(
          { actorId, clientId: a.clientId, action: "article.push", entity: "article", entityId: a.id, after: { wpPostId: a.wpPostId, url: a.wpPostUrl } },
          tx,
        );
        return a;
      });
      return updated;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      // 4xx other than 429 won't fix itself; stop retrying.
      if (/WordPress 4(?!29)\d\d/.test(lastError)) break;
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  await db.article.update({
    where: { id: articleId },
    data: { status: "PUSH_FAILED", lastPushError: lastError, pushAttempts: { increment: 1 } },
  });
  await logActivity({ actorId, clientId: article.clientId, action: "article.push_failed", entity: "article", entityId: articleId, after: { error: lastError } });
  throw new Error(lastError);
}
