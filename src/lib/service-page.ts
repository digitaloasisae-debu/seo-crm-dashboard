/**
 * The service page a blog's first paragraph must link to (Hamza's rule, 2026-11-16):
 * whatever service the blog targets, the intro links THAT service's page. Never another blog, the home page or a general hub.
 *
 * Candidates come from the client's WordPress pages (public REST API), the link pool and pages with Google clicks.
 * Blog posts are left out. Gemini picks the page for the blog's service; without Gemini a word-overlap score does.
 */
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { geminiConfigured, geminiJson } from "./gemini";

export type ServicePage = { url: string; title: string; anchor: string; why?: string };
type Page = { url: string; title: string };

const PAGES_TTL = 7 * 864e5;
const NOT_SERVICE = /^(blog|news|articles?|category|tag|author|page|feed|wp-|cart|checkout|my-account|account|login|privacy|terms|cookie|sitemap|careers?|jobs?|thank|faq|reviews?|testimonials?|gallery|portfolio|case-stud|about|contact|team)/i;
const HUB = /^(services?|our-services|solutions|what-we-do|home)$/i;
const STOP = new Set(["the", "and", "for", "with", "your", "you", "how", "what", "why", "best", "top", "guide", "tips", "near", "dubai", "uae", "in", "of", "to", "a", "an", "is", "are", "vs", "2025", "2026", "2027", "2028"]);

const norm = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
const toks = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ing|es|s)$/, "")));
const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };
const segs = (u: string) => pathOf(u).split("/").filter(Boolean);

/** Is this URL a page that could be a service page (not a blog post, hub, legal or contact page)? */
export function maybeServicePage(url: string, blogUrls: Set<string>) {
  if (!/^https?:\/\//i.test(url) || blogUrls.has(norm(url))) return false;
  const s = segs(url);
  if (!s.length) return false;
  if (s.length === 1 && HUB.test(s[0])) return false;
  if (NOT_SERVICE.test(s[0])) return false;
  if (s.some((x) => /^\d{4}$/.test(x))) return false; // dated permalinks are posts
  return true;
}

/** WordPress pages of the client's site, cached for a week. Empty when the REST API is closed. */
async function wpPages(clientId: string, siteUrl: string): Promise<Page[]> {
  const key = { keyword: `pages:${clientId}`, location: "site" };
  const hit = await db.serpBenchmark.findUnique({ where: { keyword_location: key } });
  if (hit && Date.now() - hit.fetchedAt.getTime() < PAGES_TTL) return hit.data as unknown as Page[];
  let pages: Page[] = [];
  try {
    const base = siteUrl.replace(/\/+$/, "");
    for (let p = 1; p <= 3; p++) {
      const res = await fetch(`${base}/wp-json/wp/v2/pages?per_page=100&page=${p}&_fields=link,title,status`, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0 (compatible; Rankflow/1.0)" } });
      if (!res.ok) break;
      const rows = (await res.json()) as { link?: string; title?: { rendered?: string } }[];
      if (!Array.isArray(rows) || !rows.length) break;
      pages.push(...rows.filter((r) => r.link).map((r) => ({ url: r.link!, title: (r.title?.rendered ?? "").replace(/<[^>]+>/g, "").replace(/&#8217;/g, "'").replace(/&amp;/g, "&").trim() })));
      if (rows.length < 100) break;
    }
  } catch {
    pages = [];
  }
  await db.serpBenchmark.upsert({ where: { keyword_location: key }, create: { ...key, data: pages as unknown as Prisma.InputJsonValue }, update: { data: pages as unknown as Prisma.InputJsonValue, fetchedAt: new Date() } });
  return pages;
}

/** Every page of the client that could be a service page. */
export async function serviceCandidates(clientId: string): Promise<Page[]> {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { siteUrl: true, linkPool: true, gscPages: { select: { page: true }, orderBy: { clicks: "desc" }, take: 80 } } });
  const arts = await db.article.findMany({ where: { clientId, wpPostUrl: { not: null } }, select: { wpPostUrl: true } });
  const blogUrls = new Set(arts.map((a) => norm(a.wpPostUrl!)));
  const wp = client.siteUrl ? await wpPages(clientId, client.siteUrl).catch(() => []) : [];
  const seen = new Map<string, Page>();
  const title = (u: string) => (segs(u).pop() ?? "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  for (const p of [...wp, ...client.linkPool.map((u) => ({ url: u, title: title(u) })), ...client.gscPages.map((g) => ({ url: g.page, title: title(g.page) }))]) {
    if (!maybeServicePage(p.url, blogUrls)) continue;
    const k = norm(p.url);
    if (!seen.has(k)) seen.set(k, p);
  }
  return [...seen.values()];
}

const anchorFor = (p: Page) => {
  const words = (p.title || segs(p.url).pop()?.replace(/[-_]/g, " ") || "").replace(/[|–—:].*$/, "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 4).join(" ").toLowerCase();
};

/** Picks the service page for one blog. Cached per topic (or per keyword) for a week. */
export async function servicePageFor(
  clientId: string,
  blog: { keyword: string; title: string; angle?: string | null; topicId?: string | null },
  opts: { refresh?: boolean } = {},
): Promise<ServicePage | null> {
  const key = { keyword: `svc:${blog.topicId ?? `${clientId}:${blog.keyword.toLowerCase().trim()}`}`, location: "site" };
  if (!opts.refresh) {
    const hit = await db.serpBenchmark.findUnique({ where: { keyword_location: key } });
    if (hit && Date.now() - hit.fetchedAt.getTime() < PAGES_TTL) return (hit.data as unknown as { page: ServicePage | null }).page;
  }
  const pages = await serviceCandidates(clientId);
  const want = toks(`${blog.keyword} ${blog.title}`);
  const scored = pages
    .map((p) => {
      const t = toks(`${p.title} ${segs(p.url).join(" ")}`);
      const overlap = [...want].filter((w) => t.has(w)).length;
      return { p, s: overlap + (/\/(services?|solutions?)\//i.test(p.url) ? 0.5 : 0) };
    })
    .sort((a, b) => b.s - a.s);
  let page: ServicePage | null = scored[0]?.s >= 1 ? { ...scored[0].p, anchor: anchorFor(scored[0].p), why: "Closest page by name" } : null;

  if (geminiConfigured() && pages.length) {
    try {
      const list = scored.slice(0, 60).map((x) => x.p);
      const out = await geminiJson<{ index: number | null; why?: string }>(
        `BLOG TITLE: ${blog.title}\nFOCUS KEYWORD: ${blog.keyword}${blog.angle ? `\nANGLE: ${blog.angle}` : ""}\n\nCLIENT PAGES:\n${list.map((p, i) => `${i}. ${p.title || "(no title)"} — ${p.url}`).join("\n")}`,
        {
          system: `You pick the ONE page the first paragraph of this blog must link to: the client's service page for the service this blog is selling.
Example: a blog about Amazon store growth links the Amazon services page, not the general services page, the home page or another blog.
Choose the most specific service page that matches the blog's service. If the blog's service has no page of its own, choose the closest parent service page.
Never choose the home page, contact, about, a blog post or a general "services" hub. If nothing fits at all, return null.
Return JSON: {"index": <number or null>, "why": "<one short line>"}`,
          timeoutMs: 30_000,
          temperature: 0,
        },
      );
      const p = typeof out.index === "number" ? list[out.index] : null;
      if (p) page = { ...p, anchor: anchorFor(p), why: out.why };
      else if (out.index === null) page = null;
    } catch (e) {
      console.error("service_page_failed", clientId, e);
    }
  }
  await db.serpBenchmark.upsert({ where: { keyword_location: key }, create: { ...key, data: { page } as unknown as Prisma.InputJsonValue }, update: { data: { page } as unknown as Prisma.InputJsonValue, fetchedAt: new Date() } });
  return page;
}

/** The saved choice, without fetching or calling Gemini (for the checker). */
export async function cachedServicePage(clientId: string, blog: { keyword: string; topicId?: string | null }) {
  const key = `svc:${blog.topicId ?? `${clientId}:${blog.keyword.toLowerCase().trim()}`}`;
  const hit = await db.serpBenchmark.findFirst({ where: { keyword: key } });
  return hit ? (hit.data as unknown as { page: ServicePage | null }).page : null;
}

export const sameUrl = (a: string, b: string) => norm(a) === norm(b);
