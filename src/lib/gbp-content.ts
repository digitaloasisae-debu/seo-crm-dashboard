/**
 * Google Business Profile content: weekly posts and replies to new reviews, written by AI in the
 * client's brand voice and approved in the review queue. Reviews come from DataForSEO (Google
 * reviews task). Publishing is one click to copy plus a link to Google, because Google's own
 * Business Profile API needs separate approval from Google.
 */
import { db } from "./db";
import { geminiJson } from "./gemini";
import { brandContext } from "./brand-profile";
import { dataforseoConfigured } from "./dataforseo";
import { pingbackToken } from "./crawl";
import type { GbpInfo } from "./gbp";

async function dfs(path: string, body?: unknown[]) {
  if (!dataforseoConfigured()) throw new Error("Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel first");
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64");
  const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const j = (await res.json().catch(() => null)) as { status_code?: number; status_message?: string; tasks?: { id: string; status_code: number; status_message: string; data?: { tag?: string }; result?: unknown[] | null }[] } | null;
  if (!res.ok || !j) throw new Error(`DataForSEO HTTP ${res.status}`);
  if (j.status_code !== 20000) throw new Error(`DataForSEO: ${j.status_message}`);
  return j.tasks ?? [];
}

/** Monday of this week (UTC), the key for "one post per profile per week". */
export function weekOf(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

/** Links to do the step in Google by hand. */
export function googleLinks(p: { placeId: string | null; cid: string | null }) {
  return {
    reviews: p.placeId ? `https://search.google.com/local/reviews?placeid=${p.placeId}` : p.cid ? `https://www.google.com/maps?cid=${p.cid}` : "https://business.google.com/",
    posts: "https://business.google.com/",
  };
}

// ---------- Reviews ----------

export async function queueReviewFetch(profileId: string) {
  const p = await db.gbpProfile.findUniqueOrThrow({ where: { id: profileId }, include: { client: { select: { targetCountry: true } } } });
  const info = p.data as GbpInfo | null;
  const keyword = p.placeId ? `place_id:${p.placeId}` : p.cid ? `cid:${p.cid}` : info?.title;
  if (!keyword) throw new Error("Refresh the profile first so Rankflow knows which business it is");
  const app = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const [t] = await dfs("business_data/google/reviews/task_post", [{
    keyword,
    language_code: "en",
    depth: 20,
    sort_by: "newest",
    tag: profileId,
    ...(info?.latitude && info?.longitude ? { location_coordinate: `${info.latitude},${info.longitude},5000` } : { location_name: p.client.targetCountry || process.env.DATAFORSEO_DEFAULT_COUNTRY || "United States" }),
    ...(app.startsWith("https://") ? { pingback_url: `${app}/api/gbp/pingback?id=$id&t=${pingbackToken()}` } : {}),
  }]);
  if (!t || t.status_code >= 40000) throw new Error(`DataForSEO: ${t?.status_message ?? "could not queue reviews"}`);
  await db.gbpProfile.update({ where: { id: profileId }, data: { reviewsTask: t.id } });
}

type ReviewItem = { review_id?: string; profile_name?: string; rating?: { value?: number }; review_text?: string | null; original_review_text?: string | null; timestamp?: string; owner_answer?: string | null };

/** Save the reviews from a finished task, then draft replies to the new ones. False if not ready yet. */
export async function collectReviews(taskId: string): Promise<boolean> {
  const p = await db.gbpProfile.findFirst({ where: { reviewsTask: taskId } });
  if (!p) return true;
  const [t] = await dfs(`business_data/google/reviews/task_get/${taskId}`);
  if (!t || t.status_code === 40602 || t.status_code === 40601) return false;
  if (t.status_code >= 40000) {
    await db.gbpProfile.update({ where: { id: p.id }, data: { reviewsTask: null, reviewsAt: new Date() } });
    return true;
  }
  const items = ((t.result?.[0] as { items?: ReviewItem[] } | undefined)?.items ?? []).filter((i) => i.review_id);
  const firstFetch = !p.reviewsAt;
  for (const r of items) {
    const replied = !!r.owner_answer?.trim();
    await db.gbpReview.upsert({
      where: { id: r.review_id! },
      create: {
        id: r.review_id!,
        clientId: p.clientId,
        profileId: p.id,
        author: r.profile_name ?? "A customer",
        rating: r.rating?.value ?? null,
        text: (r.review_text ?? r.original_review_text ?? "").slice(0, 4000),
        reviewedAt: r.timestamp ? new Date(r.timestamp.replace(" +00:00", "Z")) : null,
        ownerReply: r.owner_answer ?? null,
        // On the first fetch, only reviews without a reply from the last 60 days need attention.
        status: replied ? "POSTED" : firstFetch && r.timestamp && Date.now() - new Date(r.timestamp.replace(" +00:00", "Z")).getTime() > 60 * 864e5 ? "SKIPPED" : "NEW",
      },
      update: { ownerReply: r.owner_answer ?? null, ...(replied ? { status: "POSTED" } : {}) },
    });
  }
  await db.gbpProfile.update({ where: { id: p.id }, data: { reviewsTask: null, reviewsAt: new Date() } });
  await draftReplies(p.clientId).catch(() => null);
  return true;
}

/** Write reply drafts for new reviews. */
export async function draftReplies(clientId: string) {
  const fresh = await db.gbpReview.findMany({ where: { clientId, status: "NEW" }, include: { profile: { select: { label: true, data: true } } }, take: 15 });
  if (!fresh.length) return 0;
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true } });
  const brand = await brandContext(clientId);
  const out = await geminiJson<{ replies?: { id?: string; reply?: string }[] }>(
    `Write the owner's reply to each Google review for ${client.name}.
${brand ? `\n${brand}\n` : ""}
Rules: warm and human, 2-4 sentences, thank them by first name, mention something specific from their review, never sound like a template, never offer discounts or admit legal fault. For 1-3 star reviews: apologise, take it seriously, and invite them to contact the business directly to put it right. Don't use the reviewer's last name. Don't invent facts.

REVIEWS:
${fresh.map((r) => `[${r.id}] ${r.rating ?? "?"}★ by ${r.author} (${r.profile.label}): ${r.text || "(no text, rating only)"}`).join("\n")}

Return JSON: {"replies":[{"id":"<review id>","reply":"..."}]}`,
    { timeoutMs: 90_000, temperature: 0.6 },
  );
  let n = 0;
  for (const r of out.replies ?? []) {
    if (!r.id || !r.reply?.trim()) continue;
    await db.gbpReview.updateMany({ where: { id: r.id, clientId, status: "NEW" }, data: { draft: r.reply.trim().slice(0, 1500), status: "DRAFTED" } });
    n++;
  }
  return n;
}

// ---------- Weekly posts ----------

/** One "What's new" post per profile per week, in the brand voice. */
export async function draftWeeklyPosts(clientId: string, opts: { force?: boolean } = {}) {
  const wk = weekOf();
  const [client, profiles, latest, brand] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, servicesOffered: true, ctaText: true, ctaLink: true, siteUrl: true } }),
    db.gbpProfile.findMany({ where: { clientId, data: { not: { equals: null } } }, include: { posts: { orderBy: { weekOf: "desc" }, take: 4 } } }),
    db.article.findMany({ where: { clientId, status: "PUSHED_DRAFT", wpPostUrl: { not: null }, importedAt: null }, select: { metaTitle: true, metaDescription: true, wpPostUrl: true, slug: true }, orderBy: { pushedAt: "desc" }, take: 3 }),
    brandContext(clientId),
  ]);
  let n = 0;
  for (const p of profiles) {
    if (!opts.force && p.posts.some((x) => x.weekOf.getTime() === wk.getTime())) continue;
    const info = p.data as GbpInfo;
    const recent = p.posts.map((x) => x.text.slice(0, 200));
    const article = latest[n % Math.max(1, latest.length)];
    const out = await geminiJson<{ text?: string; cta?: string }>(
      `Write this week's Google Business Profile "update" post for ${client.name} (${p.label}${info.address ? `, ${info.address}` : ""}).
Category: ${info.category ?? ""}. Services: ${client.servicesOffered.slice(0, 12).join(", ")}.
${brand ? `\n${brand}\n` : ""}
${article ? `Feature this new blog post: "${article.metaTitle}" (${article.metaDescription ?? ""}).` : "Feature one service with a practical tip customers would value."}
Don't repeat these recent posts:
${recent.length ? recent.map((r) => `- ${r}`).join("\n") : "(none)"}

Rules: 80-150 words, plain text (no markdown or hashtags), mention the area served once naturally, one clear call to action, no prices or offers unless they are in the facts, no emojis or at most one.
Return JSON: {"text":"...","cta":"LEARN_MORE, CALL or BOOK"}`,
      { timeoutMs: 60_000, temperature: 0.8 },
    );
    if (!out.text?.trim()) continue;
    const link = article ? (article.wpPostUrl && !/[?&]p=\d+/.test(article.wpPostUrl) ? article.wpPostUrl : `${client.siteUrl.replace(/\/+$/, "")}/${article.slug}/`) : client.ctaLink || client.siteUrl;
    await db.gbpPost.upsert({
      where: { profileId_weekOf: { profileId: p.id, weekOf: wk } },
      create: { clientId, profileId: p.id, weekOf: wk, text: out.text.trim().slice(0, 1500), cta: out.cta ?? "LEARN_MORE", link },
      update: { text: out.text.trim().slice(0, 1500), cta: out.cta ?? "LEARN_MORE", link, status: "DRAFTED" },
    });
    n++;
  }
  return n;
}

/** Daily cron: collect review tasks, fetch reviews weekly per profile, draft this week's posts. */
export async function dailyGbp(budgetMs = 30_000) {
  const started = Date.now();
  let collected = 0, queued = 0, posts = 0;
  for (const p of await db.gbpProfile.findMany({ where: { reviewsTask: { not: null } }, select: { reviewsTask: true }, take: 50 })) {
    if (Date.now() - started > budgetMs / 3) break;
    if (await collectReviews(p.reviewsTask!).catch(() => false)) collected++;
  }
  const due = await db.gbpProfile.findMany({ where: { reviewsTask: null, data: { not: { equals: null } }, client: { status: "ACTIVE" }, OR: [{ reviewsAt: null }, { reviewsAt: { lt: new Date(Date.now() - 6.5 * 864e5) } }] }, select: { id: true }, take: 40 });
  for (const p of due) {
    if (Date.now() - started > (budgetMs * 2) / 3) break;
    if (await queueReviewFetch(p.id).then(() => true, () => false)) queued++;
  }
  const wk = weekOf();
  const needPosts = await db.client.findMany({ where: { status: "ACTIVE", gbpProfiles: { some: { data: { not: { equals: null } }, posts: { none: { weekOf: wk } } } } }, select: { id: true }, take: 10 });
  for (const c of needPosts) {
    if (Date.now() - started > budgetMs) break;
    posts += await draftWeeklyPosts(c.id).catch(() => 0);
  }
  return { collected, queued, posts };
}
