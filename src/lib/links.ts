/**
 * Internal linking helper: when an article is approved, AI picks older pages on the same site
 * that should link to it, and an exact phrase on each page to use as the anchor. "Add" inserts
 * the link into that page through the WordPress REST API (only once the new article is live).
 */
import type { ClientCredential } from "@prisma/client";
import { db } from "./db";
import { geminiJson } from "./gemini";
import { decryptSecret } from "./crypto";
import { logActivity } from "./activity";

const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
const strip = (html: string) =>
  html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

/** Where the new article lives (its permalink once published). */
export function articleUrl(a: { wpPostUrl: string | null; slug: string }, siteUrl: string) {
  if (a.wpPostUrl && !/[?&]p=\d+/.test(a.wpPostUrl)) return a.wpPostUrl;
  return `${siteUrl.replace(/\/+$/, "")}/${a.slug}/`;
}

async function fetchText(url: string) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; RankflowBot/1.0)" }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return { title: "", text: "" };
    const html = await r.text();
    return { title: strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""), text: strip(html.match(/<(article|main)[\s\S]*<\/\1>/i)?.[0] ?? html) };
  } catch {
    return { title: "", text: "" };
  }
}

/** Pick up to 5 older pages that should link to this article. */
export async function suggestLinks(articleId: string) {
  const a = await db.article.findUniqueOrThrow({ where: { id: articleId }, include: { client: { select: { id: true, siteUrl: true, linkPool: true, gscPages: { select: { page: true }, orderBy: { clicks: "desc" }, take: 40 } } } } });
  const target = articleUrl(a, a.client.siteUrl);
  const others = await db.article.findMany({ where: { clientId: a.clientId, id: { not: a.id }, wpPostUrl: { not: null } }, select: { id: true, metaTitle: true, bodyHtml: true, wpPostUrl: true, slug: true } });
  type Cand = { url: string; title: string; text: string };
  const pool = new Map<string, Cand>();
  for (const o of others) {
    const url = articleUrl(o, a.client.siteUrl);
    pool.set(norm(url), { url, title: o.metaTitle, text: strip(o.bodyHtml) });
  }
  for (const u of [...a.client.gscPages.map((p) => p.page), ...a.client.linkPool]) {
    if (!/^https?:\/\//.test(u) || pool.has(norm(u))) continue;
    pool.set(norm(u), { url: u, title: "", text: "" });
  }
  pool.delete(norm(target));
  const topic = words(`${a.focusKeyword} ${a.metaTitle}`);
  const score = (c: Cand) => [...words(`${c.title} ${c.url.replace(/[-/]/g, " ")}`)].filter((w) => topic.has(w)).length;
  const ranked = [...pool.values()].sort((x, y) => score(y) - score(x)).slice(0, 10);
  await Promise.all(ranked.filter((c) => !c.text).map(async (c) => Object.assign(c, await fetchText(c.url))));
  const cands = ranked.filter((c) => c.text.length > 200 && !c.text.includes(target));
  if (!cands.length) return 0;

  const out = await geminiJson<{ links?: { source_url?: string; anchor?: string; reason?: string }[] }>(
    `A new blog post is going live. Pick up to 5 existing pages on the same site that should link to it, and for each one an anchor phrase.

NEW POST: "${a.metaTitle}" (focus keyword: ${a.focusKeyword})
URL: ${target}

EXISTING PAGES:
${cands.map((c, i) => `[${i + 1}] ${c.url}\nTitle: ${c.title}\nText: ${c.text.slice(0, 1800)}`).join("\n\n")}

Rules:
- Only pick a page if a reader there would really benefit from the new post.
- The anchor must be 2-6 words copied EXACTLY (same spelling) from that page's text, in a normal sentence (not a heading or button), and describe the new post's topic.
- Never use generic anchors like "click here" or "read more".
Return JSON: {"links":[{"source_url":"...","anchor":"...","reason":"one short sentence"}]}`,
    { timeoutMs: 90_000, temperature: 0.2 },
  );
  let saved = 0;
  for (const l of (out.links ?? []).slice(0, 5)) {
    const c = cands.find((x) => norm(x.url) === norm(l.source_url ?? ""));
    const anchor = (l.anchor ?? "").trim();
    if (!c || anchor.split(/\s+/).length > 8 || !c.text.toLowerCase().includes(anchor.toLowerCase())) continue;
    await db.internalLink.upsert({
      where: { articleId_sourceUrl: { articleId, sourceUrl: c.url } },
      create: { clientId: a.clientId, articleId, sourceUrl: c.url, anchor, reason: (l.reason ?? "").slice(0, 300) },
      update: { anchor, reason: (l.reason ?? "").slice(0, 300), status: "SUGGESTED", error: null },
    });
    saved++;
  }
  return saved;
}

/** Wrap the first plain-text occurrence of the anchor (not in a tag, link or heading) in a link. */
export function insertLink(html: string, anchor: string, href: string): string | null {
  const re = new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+").replace(/'/g, "(?:'|&#8217;|’)"), "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const before = html.slice(0, m.index);
    if (before.lastIndexOf("<") > before.lastIndexOf(">")) continue; // inside a tag
    const open = (t: string) => (before.match(new RegExp(`<${t}[\\s>]`, "gi")) ?? []).length - (before.match(new RegExp(`</${t}>`, "gi")) ?? []).length;
    if (open("a") > 0 || open("h[1-6]") > 0 || open("button") > 0) continue;
    return `${html.slice(0, m.index)}<a href="${href}">${m[0]}</a>${html.slice(m.index + m[0].length)}`;
  }
  return null;
}

function auth(cred: ClientCredential) {
  return "Basic " + Buffer.from(`${cred.username}:${decryptSecret(cred)}`).toString("base64");
}
async function wp(cred: ClientCredential, path: string, init: RequestInit = {}) {
  const base = cred.endpoint.replace(/\/+$/, "").replace(/\/posts$/, "");
  const r = await fetch(`${base}${path}`, { ...init, headers: { Authorization: auth(cred), "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`WordPress ${r.status}: ${(j as { message?: string } | null)?.message ?? "error"}`);
  return j;
}

/** Add one suggested link to its source page in WordPress. */
export async function addLink(linkId: string, actorId?: string) {
  const l = await db.internalLink.findUniqueOrThrow({ where: { id: linkId }, include: { article: { select: { slug: true, wpPostUrl: true, metaTitle: true } }, client: { select: { siteUrl: true } } } });
  try {
    const target = articleUrl(l.article, l.client.siteUrl);
    const live = await fetch(target, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15_000) }).then((r) => r.ok, () => false);
    if (!live) throw new Error("The new article isn't live yet. Publish it in WordPress first, then add the link.");
    const cred = await db.clientCredential.findUnique({ where: { clientId_kind: { clientId: l.clientId, kind: "WORDPRESS" } } });
    if (!cred) throw new Error("No WordPress login saved for this client");
    const own = (await db.article.findMany({ where: { clientId: l.clientId, wpPostId: { not: null } }, select: { id: true, wpPostId: true, wpPostUrl: true, slug: true, bodyHtml: true } })).find((a) => norm(articleUrl(a, l.client.siteUrl)) === norm(l.sourceUrl));
    type Post = { id: number; content?: { raw?: string } };
    let post: Post | null = null, kind = "posts";
    if (own?.wpPostId) post = (await wp(cred, `/posts/${own.wpPostId}?context=edit`)) as Post;
    else {
      const slug = norm(l.sourceUrl).split("/").pop() ?? "";
      for (const k of ["posts", "pages"]) {
        const found = (await wp(cred, `/${k}?slug=${encodeURIComponent(slug)}&context=edit&status=publish`)) as Post[];
        if (found?.[0]) { post = found[0]; kind = k; break; }
      }
    }
    if (!post?.content?.raw) throw new Error("Couldn't find that page in WordPress (it may be built with a page builder)");
    if (post.content.raw.includes(target)) throw new Error("That page already links to the article");
    const next = insertLink(post.content.raw, l.anchor, target);
    if (!next) throw new Error(`Couldn't find "${l.anchor}" as plain text on that page anymore`);
    await wp(cred, `/${kind}/${post.id}`, { method: "POST", body: JSON.stringify({ content: next }) });
    if (own) {
      const body = insertLink(own.bodyHtml, l.anchor, target);
      if (body) await db.article.update({ where: { id: own.id }, data: { bodyHtml: body } });
    }
    await db.internalLink.update({ where: { id: linkId }, data: { status: "ADDED", addedAt: new Date(), error: null } });
    await logActivity({ actorId, clientId: l.clientId, action: "link.add", entity: "article", entityId: l.articleId, after: { from: l.sourceUrl, anchor: l.anchor } });
  } catch (e) {
    await db.internalLink.update({ where: { id: linkId }, data: { status: "FAILED", error: e instanceof Error ? e.message : String(e) } });
  }
}
