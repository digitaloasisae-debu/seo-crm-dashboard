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

const slugify = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

/** Upload one image (URL or data: URI) to the WordPress media library with its alt text. */
async function uploadImage(cred: ClientCredential, src: string, name: string, alt: string): Promise<{ id: number; url: string }> {
  let type = "image/png";
  let data: Buffer;
  const m = src.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (m) {
    type = m[1];
    data = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
  } else {
    const img = await fetch(src, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error(`Could not download image (${img.status})`);
    type = (img.headers.get("content-type") || "image/png").split(";")[0];
    data = Buffer.from(await img.arrayBuffer());
  }
  if (!type.startsWith("image/")) throw new Error(`Not an image (${type})`);
  const ext = { "image/jpeg": "jpg", "image/svg+xml": "svg" }[type] ?? type.split("/")[1] ?? "png";
  const q = new URLSearchParams({ alt_text: alt.slice(0, 200), title: alt.slice(0, 100) || name });
  const media = await wpFetch(cred, `/media?${q}`, {
    method: "POST",
    headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name || "image"}.${ext}"` },
    body: new Uint8Array(data),
  });
  return { id: Number(media.id), url: String(media.source_url ?? "") };
}

/**
 * Every image in the blog goes into the client's WordPress media library first, and the blog then
 * uses the WordPress copy (not imgbb or other temporary hosts). Images already on the client's site are left alone.
 * The new body is saved to the article, so a retry doesn't upload the same images twice.
 */
async function moveImagesToWordPress(cred: ClientCredential, article: { id: string; slug: string; focusKeyword: string; metaTitle: string; bodyHtml: string; featuredImageUrl: string | null; wpMediaId: number | null }, siteUrl: string) {
  const own = host(siteUrl);
  const wpHost = host(cred.endpoint);
  const isOurs = (u: string) => { const h = host(u); return !!h && (h === own || h === wpHost); };
  let body = article.bodyHtml;
  const tags = [...new Set(body.match(/<img\b[^>]*>/gi) ?? [])];
  let n = 0;
  const failed: string[] = [];
  for (const tag of tags) {
    const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    if (!src || (!/^https?:/i.test(src) && !src.startsWith("data:")) || isOurs(src)) continue;
    const alt = (tag.match(/\salt=["']([^"']*)["']/i)?.[1] ?? "").trim() || article.focusKeyword;
    n++;
    try {
      const up = await uploadImage(cred, src.replace(/&amp;/g, "&"), `${slugify(alt) || article.slug}-${n}`, alt);
      if (!up.url) continue;
      let next = tag.replace(/\ssrc=["'][^"']+["']/i, ` src="${up.url}"`).replace(/\s(srcset|sizes)=["'][^"']*["']/gi, "");
      next = /\sclass=["']/i.test(next) ? next.replace(/\sclass=["']([^"']*)["']/i, ` class="$1 wp-image-${up.id}"`) : next.replace(/<img/i, `<img class="wp-image-${up.id}"`);
      if (!/\salt=/i.test(next)) next = next.replace(/<img/i, `<img alt="${alt.replace(/"/g, "&quot;")}"`);
      body = body.split(tag).join(next);
    } catch (e) {
      failed.push(`${src.slice(0, 80)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Featured image: also uploaded to the media library, with the focus keyword as alt text (SOP Step 5).
  let mediaId = article.wpMediaId;
  let featured = article.featuredImageUrl;
  if (!mediaId && featured) {
    const up = await uploadImage(cred, featured, article.slug || "featured", article.focusKeyword || article.metaTitle);
    mediaId = up.id;
    if (up.url) featured = up.url;
  }
  if (body !== article.bodyHtml || mediaId !== article.wpMediaId || featured !== article.featuredImageUrl) {
    await db.article.update({ where: { id: article.id }, data: { bodyHtml: body, wpMediaId: mediaId, featuredImageUrl: featured } });
  }
  return { body, mediaId, failed };
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
      const fresh = await db.article.findUniqueOrThrow({ where: { id: articleId }, select: { id: true, slug: true, focusKeyword: true, metaTitle: true, bodyHtml: true, featuredImageUrl: true, wpMediaId: true, client: { select: { siteUrl: true } } } });
      const { body, mediaId, failed } = await moveImagesToWordPress(cred, fresh, fresh.client.siteUrl);
      if (failed.length) await logActivity({ actorId, clientId: article.clientId, action: "article.images_failed", entity: "article", entityId: articleId, after: { failed } });

      const slot = article.wpPostId ? null : await nextOpenSlot(article.clientId);
      const payload: Record<string, unknown> = {
        // Imported posts keep their own headline; the SEO title goes into Rank Math.
        title: article.wpTitle ?? article.metaTitle,
        content: body,
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
