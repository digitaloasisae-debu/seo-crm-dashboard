/**
 * Competitor research for Social Studio.
 *
 * Instagram: the Business Discovery API returns the public posts of any business or creator account
 * (caption, likes, comments, type, date) using our own Instagram account and token. Other accounts'
 * reach is private, so posts are ranked by engagement = (likes + comments) / followers.
 * Our own posts also get reach and saves from Instagram insights.
 *
 * The AI then studies what competitors target, which posts and formats win, how their captions are
 * built and where the gaps are. Ideas and captions learn from it indirectly: never copied, never named.
 */
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { geminiJson } from "../gemini";

const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v26.0"}`;

export function metaConfigured() {
  return Boolean(process.env.META_ACCESS_TOKEN);
}

export type Research = {
  summary: string;
  targeting: string[];
  winners: { handle: string; why: string; permalink?: string }[];
  formats: string[];
  hooks: string[];
  captions: string[];
  visuals: string[];
  flops: string[];
  gaps: string[];
  ourAccount: string;
  rules: string[];
  stats?: { handle: string; followers: number; posts: number; avgEngagement: number; perWeek: number }[];
};

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN is not set in Vercel");
  const url = `${GRAPH()}/${path}?${new URLSearchParams({ ...params, access_token: token })}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const m = j?.error?.message || `HTTP ${r.status}`;
    if (/expired|Session has expired|validating access token/i.test(m)) throw new Error("The Meta token in Vercel (META_ACCESS_TOKEN) has expired. Make a new long-lived one and update it.");
    throw new Error(m);
  }
  return j as T;
}

/** Our Instagram account id: the project's setting, or the one linked to its Facebook Page. */
async function ourIgId(p: { igUserId: string | null; fbPageId: string | null }) {
  if (p.igUserId) return p.igUserId;
  if (!p.fbPageId) throw new Error("Add the Facebook Page ID (or Instagram ID) to this project first");
  const r = await graph<{ instagram_business_account?: { id: string } }>(p.fbPageId, { fields: "instagram_business_account" });
  if (!r.instagram_business_account?.id) throw new Error("No Instagram business account is linked to this Facebook Page");
  return r.instagram_business_account.id;
}

type IgMedia = { id: string; caption?: string; like_count?: number; comments_count?: number; media_type?: string; media_product_type?: string; permalink?: string; timestamp: string; media_url?: string; thumbnail_url?: string; insights?: { data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] } };
type Discovery = { business_discovery?: { username: string; followers_count?: number; media_count?: number; media?: { data: IgMedia[] } } };

const clean = (h: string) => h.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").toLowerCase();
export const cleanHandles = (xs: string[]) => [...new Set(xs.map(clean).filter((h) => /^[a-z0-9._]{1,30}$/.test(h)))].slice(0, 12);

async function saveMedia(projectId: string, handle: string, isOwn: boolean, followers: number, media: IgMedia[]) {
  for (const m of media) {
    const likes = m.like_count ?? 0;
    const comments = m.comments_count ?? 0;
    const metric = (n: string) => {
      const d = m.insights?.data.find((x) => x.name === n);
      return d ? (d.total_value?.value ?? d.values?.[0]?.value ?? null) : null;
    };
    const data = {
      handle,
      isOwn,
      caption: (m.caption ?? "").slice(0, 3000),
      mediaType: m.media_product_type === "REELS" ? "REEL" : (m.media_type ?? ""),
      permalink: m.permalink ?? "",
      mediaUrl: m.media_type === "VIDEO" ? (m.thumbnail_url ?? null) : (m.media_url ?? null),
      likes,
      comments,
      reach: metric("reach"),
      saves: metric("saved"),
      followers,
      engagement: followers ? Math.round(((likes + comments) / followers) * 10000) / 100 : 0,
      postedAt: new Date(m.timestamp),
      fetchedAt: new Date(),
    };
    await db.socialRivalPost.upsert({ where: { projectId_postId: { projectId, postId: m.id } }, create: { projectId, postId: m.id, ...data }, update: data });
  }
}

/** Pull the latest public posts of every competitor plus our own, into SocialRivalPost. Returns problems per account. */
export async function fetchInstagram(projectId: string) {
  const p = await db.socialProject.findUniqueOrThrow({ where: { id: projectId } });
  const ig = await ourIgId(p);
  const problems: string[] = [];
  const FIELDS = "id,caption,like_count,comments_count,media_type,media_product_type,permalink,timestamp,media_url,thumbnail_url";
  for (const handle of cleanHandles(p.competitors)) {
    try {
      const r = await graph<Discovery>(ig, { fields: `business_discovery.username(${handle}){username,followers_count,media_count,media.limit(40){${FIELDS}}}` });
      const b = r.business_discovery;
      if (!b) throw new Error("not found");
      await saveMedia(projectId, handle, false, b.followers_count ?? 0, b.media?.data ?? []);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      problems.push(`@${handle}: ${/business|creator|not found|Cannot find|Invalid user/i.test(m) ? "not found, or it's a personal account (only business and creator accounts can be read)" : m}`);
    }
  }
  // Our own account, with reach and saves where Instagram gives them.
  try {
    const me = await graph<{ username: string; followers_count?: number }>(ig, { fields: "username,followers_count" });
    let media: IgMedia[] = [];
    try {
      media = (await graph<{ data: IgMedia[] }>(`${ig}/media`, { fields: `${FIELDS},insights.metric(reach,saved)`, limit: "30" })).data;
    } catch {
      media = (await graph<{ data: IgMedia[] }>(`${ig}/media`, { fields: FIELDS, limit: "30" })).data;
    }
    await saveMedia(projectId, me.username, true, me.followers_count ?? 0, media);
  } catch (e) {
    problems.push(`Our account: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Forget accounts that were removed from the list.
  await db.socialRivalPost.deleteMany({ where: { projectId, isOwn: false, handle: { notIn: cleanHandles(p.competitors) } } });
  return problems;
}

/** Describe what the best-performing competitor images look like (the AI looks at up to 6 of them). */
async function describeVisuals(urls: string[]): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !urls.length) return "";
  const parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] = [];
  for (const u of urls.slice(0, 6)) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 4_000_000) continue;
      parts.push({ inlineData: { mimeType: r.headers.get("content-type")?.split(";")[0] || "image/jpeg", data: buf.toString("base64") } });
    } catch {
      /* skip */
    }
  }
  if (!parts.length) return "";
  parts.push({ text: "These are the best-performing Instagram posts of competitors. In 5-8 short bullet points, describe what the visuals have in common: real photo vs designed graphic, people or not, amount of text, fonts, colours, layout, how polished or raw they look, anything that makes them stand out in a feed. Be concrete. Return JSON: {\"points\":[\"...\"]}" });
  const model = process.env.GEMINI_SOCIAL_MODEL || process.env.GEMINI_MODEL || "gemini-flash-latest";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
    signal: AbortSignal.timeout(90_000),
  });
  const j = await res.json().catch(() => ({}));
  try {
    const text = j?.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text ?? "").join("") ?? "";
    return (JSON.parse(text).points as string[]).map((x) => `- ${x}`).join("\n");
  } catch {
    return "";
  }
}

const weeks = (from: Date, to: Date) => Math.max(1, (to.getTime() - from.getTime()) / (7 * 864e5));

/**
 * Full research run for one project: fetch Instagram (when a Meta token is set), then let the AI
 * study competitors' posts and our own. Saves the findings on the project.
 */
export async function runResearch(projectId: string): Promise<Research> {
  const p = await db.socialProject.findUniqueOrThrow({ where: { id: projectId }, include: { client: { select: { name: true, businessType: true, primaryCity: true, targetCountry: true } } } });
  const problems: string[] = [];
  if (p.competitors.length || p.igUserId || p.fbPageId) {
    if (metaConfigured()) problems.push(...(await fetchInstagram(projectId).catch((e) => [e instanceof Error ? e.message : String(e)])));
    else if (p.competitors.length) problems.push("META_ACCESS_TOKEN is not set in Vercel, so Instagram could not be read");
  }
  const since = new Date(Date.now() - 120 * 864e5);
  const posts = await db.socialRivalPost.findMany({ where: { projectId, postedAt: { gte: since } }, orderBy: { engagement: "desc" } });
  const rivals = posts.filter((x) => !x.isOwn);
  const own = posts.filter((x) => x.isOwn);
  if (!rivals.length && !own.length ) {
    const msg = problems.join(" · ") || "Add competitor Instagram accounts first";
    await db.socialProject.update({ where: { id: projectId }, data: { researchError: msg } });
    throw new Error(msg);
  }

  const stats = [...new Set(posts.map((x) => x.handle))].map((h) => {
    const xs = posts.filter((x) => x.handle === h);
    const dates = xs.map((x) => x.postedAt.getTime());
    return {
      handle: h,
      followers: xs[0].followers,
      posts: xs.length,
      avgEngagement: Math.round((xs.reduce((a, x) => a + x.engagement, 0) / xs.length) * 100) / 100,
      perWeek: Math.round((xs.length / weeks(new Date(Math.min(...dates)), new Date())) * 10) / 10,
    };
  });
  const line = (x: (typeof posts)[number]) =>
    `- @${x.handle} | ${x.mediaType} | ${x.postedAt.toISOString().slice(0, 10)} | ${x.likes} likes, ${x.comments} comments${x.reach != null ? `, reach ${x.reach}` : ""}${x.saves != null ? `, ${x.saves} saves` : ""} | engagement ${x.engagement}% | ${x.permalink}\n  "${x.caption.replace(/\s+/g, " ").slice(0, 500)}"`;
  const top = rivals.slice(0, 30);
  const bottom = rivals.slice(-8);
  const visuals = await describeVisuals(top.filter((x) => x.mediaUrl).slice(0, 6).map((x) => x.mediaUrl!));

  const prompt = `You are a senior social media strategist. Study these competitors of ${p.client.name} (${p.client.businessType ?? "business"}, ${[p.client.primaryCity, p.client.targetCountry].filter(Boolean).join(", ")}). Our targeted services: ${p.services.join(", ")}.

Reach of other accounts is private, so "engagement" = (likes + comments) / followers. Compare posts against each account's own average, not just raw likes.

ACCOUNTS (last 120 days):
${stats.map((s) => `- @${s.handle}${own.some((o) => o.handle === s.handle) ? " (US)" : ""}: ${s.followers} followers, ${s.posts} posts, ${s.perWeek}/week, average engagement ${s.avgEngagement}%`).join("\n") || "(none)"}

COMPETITORS' BEST POSTS:
${top.map(line).join("\n") || "(none)"}

COMPETITORS' WEAKEST POSTS:
${bottom.map(line).join("\n") || "(none)"}

OUR OWN RECENT POSTS:
${own.slice(0, 20).map(line).join("\n") || "(none yet)"}

WHAT THEIR BEST IMAGES LOOK LIKE:
${visuals || "(not available)"}

Return JSON:
{"summary":"3-4 sentences: what competitors are doing and what we should learn",
"targeting":["which services, audiences, pains and offers they focus on, one per item"],
"winners":[{"handle":"account","why":"why this post beat their average (topic, hook, format, timing)","permalink":"url"}],
"formats":["which formats win (reel, carousel, single image, text graphic, real photos vs designed) with evidence"],
"hooks":["opening-line patterns that win, with a short example of the pattern (not a copied line)"],
"captions":["caption patterns: length, structure, CTA style, hashtags, emojis, language"],
"visuals":["what winning images look like and how we can stand out"],
"flops":["what gets ignored"],
"gaps":["topics or angles about OUR services that competitors miss or do badly: our openings"],
"ourAccount":"how our posts compare (if any) and the 2-3 biggest fixes",
"rules":["8-12 concrete rules for our idea planner, copywriter and designer. Learn from the patterns, never copy competitors' wording, never mention competitors"]}
Max 6 items per list (winners max 5). Be specific and evidence-based.`;
  const r = await geminiJson<Partial<Research>>(prompt, { timeoutMs: 180_000, temperature: 0.3, model: process.env.GEMINI_SOCIAL_MODEL || process.env.GEMINI_WRITER_MODEL || undefined });
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 12) : []);
  const research: Research = {
    summary: String(r.summary ?? ""),
    targeting: arr(r.targeting),
    winners: (Array.isArray(r.winners) ? r.winners : []).slice(0, 5).map((w) => ({ handle: String(w.handle ?? ""), why: String(w.why ?? ""), permalink: w.permalink ? String(w.permalink) : undefined })),
    formats: arr(r.formats),
    hooks: arr(r.hooks),
    captions: arr(r.captions),
    visuals: arr(r.visuals),
    flops: arr(r.flops),
    gaps: arr(r.gaps),
    ourAccount: String(r.ourAccount ?? ""),
    rules: arr(r.rules),
    stats,
  };
  await db.socialProject.update({ where: { id: projectId }, data: { research: research as unknown as Prisma.InputJsonValue, researchAt: new Date(), researchError: problems.length ? problems.join(" · ").slice(0, 1000) : null } });
  return research;
}

/** Research older than this is refreshed before a month is planned. */
const STALE_DAYS = 14;

/** Make sure the research is fresh before planning (best effort: planning still runs if it fails). */
export async function ensureResearch(projectId: string) {
  const p = await db.socialProject.findUniqueOrThrow({ where: { id: projectId }, select: { competitors: true, researchAt: true } });
  if (!p.competitors.length) return;
  if (p.researchAt && Date.now() - p.researchAt.getTime() < STALE_DAYS * 864e5) return;
  await runResearch(projectId).catch((e) => console.error("social.research_failed", projectId, e));
}

/** The research as a prompt section for the planner, copywriter or designer. */
export function researchText(r: unknown, part: "ideas" | "captions" | "visuals"): string {
  const x = r as Research | null;
  if (!x || !x.rules) return "";
  const list = (title: string, xs: string[]) => (xs.length ? `${title}:\n${xs.map((s) => `- ${s}`).join("\n")}` : "");
  const body =
    part === "ideas"
      ? [list("What competitors target", x.targeting), list("Why their best posts won", x.winners.map((w) => w.why)), list("What gets ignored", x.flops), list("Gaps we can own", x.gaps), list("Rules", x.rules)]
      : part === "captions"
        ? [list("Opening-line patterns that win", x.hooks), list("Caption patterns that win", x.captions), list("Rules", x.rules)]
        : [list("What winning images look like", x.visuals), list("Formats that win", x.formats)];
  const text = body.filter(Boolean).join("\n\n");
  return text ? `## Competitor research (learn from the patterns; never copy their wording, never mention competitors)\n${text}` : "";
}
