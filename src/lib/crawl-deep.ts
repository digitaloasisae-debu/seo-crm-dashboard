/**
 * Deep analysis on top of a finished DataForSEO crawl: Core Web Vitals (PageSpeed + real Chrome users),
 * internal linking (click depth, weakly linked pages), heavy/slow pages and images, indexing compared with
 * Search Console, keyword cannibalisation, security headers, and an AI executive summary + action plan.
 * Runs in the background (about 1–2 minutes) and is stored on SiteCrawl.advanced.
 */
import type { Prisma, SiteCrawl } from "@prisma/client";
import { db } from "./db";
import { dfsPost } from "./dataforseo";
import { pageSpeed, type PsiSummary } from "./audit";
import { gscQuery } from "./google";
import { geminiConfigured, geminiJson } from "./gemini";
import { refreshIssues, type CrawlIssue } from "./crawl";
import { keywordConsistency, marketData, templateContent, type KeywordRow, type Market, type Template } from "./crawl-market";

export type DeepPage = { url: string; value: number };
export type Cannibal = { query: string; impressions: number; pages: { url: string; clicks: number; impressions: number; position: number }[] };
export type Category = { key: string; label: string; score: number; note: string };
export type Action = { title: string; why: string; impact: "high" | "medium" | "low"; effort: string; category: string };
/** Bump when the analysis changes, so older reports are rebuilt automatically when opened. */
export const DEEP_VERSION = 4;
export type SiteFiles = {
  robots: boolean;
  sitemaps: string[];
  sitemapUrls: number;
  /** Sitemap URLs that redirect, error or aren't indexable in the crawl. */
  sitemapBad: DeepPage[];
  /** Live pages the crawl found that aren't in the sitemap. */
  notInSitemap: DeepPage[];
  /** Sitemap URLs the crawl never reached (often orphans, or beyond the page limit). */
  sitemapNotCrawled: number;
  llmsTxt: boolean;
  aiBotsBlocked: string[];
  /** Most recent blog/news post in the sitemap (by lastmod). */
  newestPost?: { url: string; date: string } | null;
};
export type Section = { description: string[]; fix: string[] };
export type SectionKey = "onpage" | "content" | "images" | "speed" | "technical" | "offpage" | "ai";
export type RoadmapMonth = { month: number; focus: string; tasks: string; outcome: string };
export type SchemaPage = { url: string; types: string[]; og: boolean; lang: string; viewport: boolean; hreflang?: { lang: string; href: string }[] };
export type Hreflang = { pages: number; langs: string[]; problems: { url: string; problem: string }[]; multiLangNoTags: boolean };
export type CrawlDeep = {
  version?: number;
  generatedAt: string;
  /** Why the Google visibility section is missing, when it is. */
  gscState?: "ok" | "not_linked" | "no_data" | "mismatch";
  files?: SiteFiles | null;
  schema?: SchemaPage[];
  /** Only filled for multi-language sites (hreflang tags found, or pages in different languages). */
  hreflang?: Hreflang | null;
  keywords?: KeywordRow[];
  template?: Template | null;
  market?: Market | null;
  overall: number;
  categories: Category[];
  speed: { url: string; mobile: PsiSummary; desktop: PsiSummary }[];
  status: Record<string, number>;
  depth: Record<string, number>;
  deepPages: DeepPage[];
  weakLinked: DeepPage[];
  slowPages: DeepPage[];
  heavyPages: DeepPage[];
  thinPages: DeepPage[];
  lowScorePages: DeepPage[];
  bigImages: DeepPage[];
  indexing: { crawledOk: number; withImpressions: number; noImpressions: DeepPage[]; notCrawled: DeepPage[]; gsc: boolean } | null;
  cannibal: Cannibal[];
  security: { https: boolean; headers: Record<string, boolean>; mixedContent: string[] } | null;
  ai: { summary: string; strengths: string[]; actions: Action[]; quickWins: string[]; sections?: Partial<Record<SectionKey, Section>>; roadmap?: RoadmapMonth[]; conclusion?: string } | null;
  notes: string[];
};

const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
type PageItem = {
  url: string; checks?: Record<string, boolean>; status_code?: number; click_depth?: number; size?: number; onpage_score?: number; resource_type?: string;
  meta?: { inbound_links_count?: number; content?: { plain_text_word_count?: number } };
  page_timing?: { duration_time?: number; time_to_interactive?: number };
};

const SEC_HEADERS: Record<string, string> = {
  "strict-transport-security": "HSTS (forces HTTPS)",
  "content-security-policy": "Content Security Policy",
  "x-content-type-options": "X-Content-Type-Options",
  "x-frame-options": "Clickjacking protection (X-Frame-Options)",
  "referrer-policy": "Referrer-Policy",
  "permissions-policy": "Permissions-Policy",
};
export const SECURITY_LABELS = SEC_HEADERS;

async function security(target: string) {
  try {
    const res = await fetch(`https://${target}/`, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; RankflowAudit/1.0)" }, signal: AbortSignal.timeout(15_000) });
    const html = await res.text();
    const headers = Object.fromEntries(Object.keys(SEC_HEADERS).map((h) => [h, res.headers.has(h) || (h === "x-frame-options" && /frame-ancestors/i.test(res.headers.get("content-security-policy") ?? ""))]));
    const mixed = [...new Set([...html.matchAll(/(?:src|href)=["'](http:\/\/[^"']+\.(?:js|css|png|jpe?g|gif|webp|svg|woff2?)(?:\?[^"']*)?)["']/gi)].map((m) => m[1]))].slice(0, 10);
    return { https: res.url.startsWith("https://"), headers, mixedContent: mixed };
  } catch {
    return null;
  }
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; RankflowAudit/1.0)" };
async function getText(url: string, ms = 12_000) {
  try {
    const res = await fetch(url, { redirect: "follow", headers: UA, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return { text: await res.text(), type: res.headers.get("content-type") ?? "", url: res.url || url };
  } catch {
    return null;
  }
}

const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"];

/** Which of the AI crawlers robots.txt shuts out of the whole site. */
export function blockedBots(robots: string) {
  const groups: { agents: string[]; rules: string[] }[] = [];
  let cur: { agents: string[]; rules: string[] } | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [k, v] = [m[1].toLowerCase(), m[2].trim()];
    if (k === "user-agent") {
      if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(v.toLowerCase());
    } else if (cur && (k === "disallow" || k === "allow")) cur.rules.push(`${k}:${v}`);
  }
  const blocksAll = (g: { rules: string[] }) => g.rules.includes("disallow:/") && !g.rules.some((r) => r === "allow:/" );
  return AI_BOTS.filter((bot) => {
    const own = groups.find((g) => g.agents.includes(bot.toLowerCase()));
    if (own) return blocksAll(own);
    const star = groups.find((g) => g.agents.includes("*"));
    return !!star && blocksAll(star);
  });
}

/** robots.txt, XML sitemaps compared with the crawl, llms.txt and AI crawler access. */
async function siteFiles(target: string, pages: PageItem[]): Promise<SiteFiles | null> {
  const base = `https://${target}`;
  const [robotsRes, llms] = await Promise.all([getText(`${base}/robots.txt`), getText(`${base}/llms.txt`)]);
  const robots = robotsRes && !/html/i.test(robotsRes.type) ? robotsRes.text : null;
  const declared = robots ? [...robots.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]) : [];
  const candidates = declared.length ? declared : [`${base}/sitemap_index.xml`, `${base}/sitemap.xml`, `${base}/wp-sitemap.xml`];
  const urls = new Set<string>();
  const found: string[] = [];
  const queue = [...new Set(candidates)].slice(0, 5);
  const seen = new Set(queue);
  let newestPost: { url: string; date: string } | null = null;
  let fetched = 0;
  while (queue.length && fetched < 25 && urls.size < 10_000) {
    const batch = queue.splice(0, 6);
    fetched += batch.length;
    const docs = await Promise.all(batch.map((u) => getText(u, 15_000)));
    docs.forEach((d, i) => {
      if (!d || !/<(urlset|sitemapindex)/i.test(d.text)) return;
      found.push(batch[i]);
      const locs = [...d.text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
      if (/<sitemapindex/i.test(d.text)) {
        for (const l of locs) if (!seen.has(l)) { seen.add(l); queue.push(l); }
      } else {
        locs.forEach((l) => urls.add(l));
        const postMap = /post|blog|news|article/i.test(batch[i]);
        for (const m of d.text.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
          const loc = m[1].match(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/i)?.[1];
          const mod = m[1].match(/<lastmod>\s*([^<\s]+)/i)?.[1];
          if (!loc || !mod || isNaN(Date.parse(mod))) continue;
          if ((postMap || /\/(blog|news|articles?)\/[^/]+/i.test(loc)) && (!newestPost || mod > newestPost.date)) newestPost = { url: loc, date: mod.slice(0, 10) };
        }
      }
    });
  }
  if (!robots && !found.length && !llms) return null;
  const byUrl = new Map(pages.map((p) => [norm(p.url), p]));
  const inMap = new Set([...urls].map(norm));
  const sitemapBad: DeepPage[] = [];
  let notCrawled = 0;
  for (const u of urls) {
    const p = byUrl.get(norm(u));
    if (!p) { notCrawled++; continue; }
    const code = p.status_code ?? 0;
    if (code !== 200 || p.checks?.is_redirect) sitemapBad.push({ url: u, value: code });
  }
  const notInSitemap = urls.size
    ? pages.filter((p) => p.status_code === 200 && (p.resource_type ?? "html") === "html" && !inMap.has(norm(p.url))).map((p) => ({ url: p.url, value: p.meta?.inbound_links_count ?? 0 })).slice(0, 25)
    : [];
  return {
    robots: !!robots, sitemaps: found.slice(0, 10), sitemapUrls: urls.size, sitemapBad: sitemapBad.slice(0, 25), notInSitemap, sitemapNotCrawled: notCrawled,
    llmsTxt: !!llms && !/html/i.test(llms.type) && llms.text.trim().length > 20, aiBotsBlocked: robots ? blockedBots(robots) : [], newestPost,
  };
}

/** Structured data (JSON-LD and microdata), social tags, language and viewport on the most important pages. */
export function schemaFor(url: string, html: string): SchemaPage {
  const types = new Set<string>();
  const add = (t: unknown) => (Array.isArray(t) ? t : [t]).forEach((x) => typeof x === "string" && types.add(x.replace(/^https?:\/\/schema\.org\//, "")));
  const walk = (o: unknown, d = 0): void => {
    if (!o || typeof o !== "object" || d > 6) return;
    if (Array.isArray(o)) return o.forEach((x) => walk(x, d + 1));
    const r = o as Record<string, unknown>;
    if (r["@type"]) add(r["@type"]);
    if (r["@graph"]) walk(r["@graph"], d + 1);
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { types.add("(invalid JSON-LD)"); }
  }
  for (const m of html.matchAll(/itemtype=["']https?:\/\/schema\.org\/([A-Za-z]+)/gi)) types.add(m[1]);
  return {
    url, types: [...types].slice(0, 12),
    og: /<meta[^>]+property=["']og:title["']/i.test(html) && /<meta[^>]+property=["']og:image["']/i.test(html),
    lang: html.match(/<html[^>]*\slang=["']([^"']+)/i)?.[1] ?? "",
    viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    hreflang: [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /rel=["']alternate["']/i.test(t) && /hreflang=/i.test(t))
      .map((t) => ({ lang: t.match(/hreflang=["']([^"']+)/i)?.[1] ?? "", href: t.match(/href=["']([^"']+)/i)?.[1] ?? "" })).filter((h) => h.lang && h.href).slice(0, 40),
  };
}

async function schemaPages(urls: string[]) {
  const res = await Promise.all(urls.map(async (u) => { const r = await getText(u); return r && /html/i.test(r.type) ? schemaFor(u, r.text) : null; }));
  return res.filter((x): x is SchemaPage => !!x);
}

const LANG_RE = /^(x-default|[a-z]{2,3}(-([a-z]{4}|[a-z]{2}|\d{3}))?)$/i;

/** hreflang checks on the key pages: valid codes, self-reference, x-default and return links. */
export async function checkHreflang(pages: SchemaPage[], fetchPage = schemaPages): Promise<Hreflang | null> {
  const tagged = pages.filter((p) => p.hreflang?.length);
  const langs = [...new Set(pages.map((p) => p.lang.toLowerCase().slice(0, 2)).filter(Boolean))];
  if (!tagged.length) return langs.length > 1 ? { pages: 0, langs, problems: [], multiLangNoTags: true } : null;
  const problems: { url: string; problem: string }[] = [];
  for (const p of tagged) {
    const tags = p.hreflang!;
    const bad = tags.filter((t) => !LANG_RE.test(t.lang)).map((t) => t.lang);
    if (bad.length) problems.push({ url: p.url, problem: `Invalid language codes: ${[...new Set(bad)].join(", ")} (use e.g. en, en-GB, ur-PK)` });
    if (!tags.some((t) => norm(t.href) === norm(p.url))) problems.push({ url: p.url, problem: "Doesn't list itself in its own hreflang tags" });
    if (!tags.some((t) => t.lang.toLowerCase() === "x-default")) problems.push({ url: p.url, problem: "No x-default (the fallback page for other languages)" });
    const dup = tags.map((t) => t.lang.toLowerCase()).filter((l, i, a) => a.indexOf(l) !== i);
    if (dup.length) problems.push({ url: p.url, problem: `Same language listed twice: ${[...new Set(dup)].join(", ")}` });
    if (tags.some((t) => !/^https?:\/\//i.test(t.href))) problems.push({ url: p.url, problem: "Uses relative URLs; hreflang needs full https:// URLs" });
  }
  // Return links: the alternates of the first tagged page must point back to it.
  const first = tagged[0];
  const alts = first.hreflang!.filter((t) => /^https?:\/\//i.test(t.href) && norm(t.href) !== norm(first.url)).map((t) => t.href);
  const altPages = await fetchPage([...new Set(alts)].slice(0, 6)).catch(() => [] as SchemaPage[]);
  for (const a of altPages) if (!a.hreflang?.some((t) => norm(t.href) === norm(first.url))) problems.push({ url: a.url, problem: `No return link to ${first.url.replace(/^https?:\/\/[^/]+/, "") || "/"} (hreflang must be reciprocal or Google ignores it)` });
  return { pages: tagged.length, langs: [...new Set([...langs, ...tagged.flatMap((p) => p.hreflang!.map((t) => t.lang.toLowerCase()))])].slice(0, 20), problems: problems.slice(0, 30), multiLangNoTags: false };
}

/** AI search readiness: can ChatGPT, Claude, Perplexity and Google's AI read the site and understand the business? */
function aiReady(files: SiteFiles | null, schema: SchemaPage[]): Category[] | null {
  if (!files && !schema.length) return null;
  const homeTypes = schema[0]?.types ?? [];
  const org = homeTypes.some((t) => /Organization|LocalBusiness|Corporation|Person|ProfessionalService|Store|Restaurant|Clinic|Physician|Dentist|Attorney|Agent|Hotel/i.test(t));
  const withSchema = schema.filter((p) => p.types.length && !p.types.every((t) => t === "(invalid JSON-LD)")).length;
  const blocked = files?.aiBotsBlocked.length ?? 0;
  const score = (org ? 35 : 0) + (schema.length ? (withSchema / schema.length) * 25 : 0) + (blocked ? Math.max(0, 30 - blocked * 6) : 30) + (files?.llmsTxt ? 10 : 0);
  const bits = [org ? "business schema on the home page" : "no business schema on the home page", `${withSchema} of ${schema.length} key pages with schema`, blocked ? `${blocked} AI crawler${blocked === 1 ? "" : "s"} blocked` : "AI crawlers allowed", files?.llmsTxt ? "llms.txt found" : "no llms.txt"];
  return [{ key: "ai", label: "AI search readiness", score: clamp(score), note: bits.join(", ") }];
}

/** Runs the deep analysis for a finished crawl and saves it. Safe to call again (overwrites). */
export async function runDeep(crawl: SiteCrawl): Promise<CrawlDeep> {
  if (crawl.status !== "DONE" || !crawl.taskId) throw new Error("The crawl isn't finished yet");
  const notes: string[] = [];
  const client = await db.client.findUniqueOrThrow({ where: { id: crawl.clientId }, select: { name: true, businessType: true, primaryCity: true, gscProperty: true, gscConnectionId: true } });
  const gscLinked = !!client.gscProperty && !!client.gscConnectionId;
  const home = `https://${crawl.target}/`;

  // 1) Everything in parallel: crawl pages, big images, GSC, security headers.
  const [pagesRes, imagesRes, gscPages, gscQP, sec, topGsc] = await Promise.all([
    dfsPost<{ items?: PageItem[] }>("on_page/pages", [{ id: crawl.taskId, limit: 1000 }], 60_000).catch((e) => { notes.push(`Page list: ${e instanceof Error ? e.message : e}`); return []; }),
    dfsPost<{ items?: { url: string; size?: number; total_transfer_size?: number }[] }>("on_page/resources", [{ id: crawl.taskId, limit: 25, filters: [["resource_type", "=", "image"], "and", ["size", ">", 200000]], order_by: ["size,desc"] }], 40_000).catch(() => []),
    gscLinked ? gscQuery(crawl.clientId, ["page"], 28, 5000).catch((e) => { notes.push(`Search Console: ${e instanceof Error ? e.message : e}`); return null; }) : Promise.resolve(null),
    gscLinked ? gscQuery(crawl.clientId, ["query", "page"], 28, 5000).catch(() => null) : Promise.resolve(null),
    security(crawl.target),
    db.gscPage.findMany({ where: { clientId: crawl.clientId }, orderBy: { clicks: "desc" }, take: 6, select: { page: true } }),
  ]);
  const pages = pagesRes[0]?.items ?? [];
  // on_page/pages lists HTML pages plus redirects and broken URLs (images and scripts are separate resources).
  const ok = pages.filter((p) => (p.status_code ?? 0) >= 200 && (p.status_code ?? 0) < 300 && (p.resource_type ?? "html") === "html");

  // 2) Speed: home + the top 2 pages from Search Console, mobile and desktop.
  const speedUrls = [home, ...topGsc.map((p) => p.page).filter((u) => norm(u) !== norm(home))].slice(0, 3);
  // Structured data on the home page, the top Search Console pages and a few pages one click from home.
  const schemaUrls = [home, ...topGsc.map((p) => p.page), ...ok.filter((p) => p.click_depth === 1).map((p) => p.url)]
    .filter((u, i, a) => a.findIndex((x) => norm(x) === norm(u)) === i).slice(0, 8);
  const [speed, files, schema, homeHtml, template, market] = await Promise.all([
    Promise.all(speedUrls.map(async (url) => {
      const [mobile, desktop] = await Promise.all([pageSpeed(url, "mobile"), pageSpeed(url, "desktop")]);
      return { url, mobile, desktop };
    })),
    siteFiles(crawl.target, pages).catch(() => null),
    schemaPages(schemaUrls).catch(() => [] as SchemaPage[]),
    getText(home).then((r) => r?.text ?? null),
    templateContent(ok.map((p) => p.url), home).catch(() => null),
    marketData(crawl.clientId, crawl.target).catch((e) => { notes.push(`Market data: ${e instanceof Error ? e.message : e}`); return null; }),
  ]);
  const keywords = homeHtml ? keywordConsistency(homeHtml) : [];
  if (market?.notes.length) notes.push(...market.notes);

  const hreflang = await checkHreflang(schema).catch(() => null);

  // 3) Crawl-based metrics.
  const status: Record<string, number> = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  for (const p of pages) { const c = p.status_code ?? 0; const k = `${Math.floor(c / 100)}xx`; if (k in status) status[k]++; }
  // Only the home page is really 0 clicks deep. Other pages at 0 (or without a depth) were found through the
  // sitemap, not by following links, so they go in their own "no link path" bucket.
  const depth: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5+": 0, none: 0 };
  for (const p of ok) {
    const d = p.click_depth;
    const isHome = norm(p.url) === norm(home);
    depth[isHome ? "0" : d == null || d <= 0 ? "none" : d >= 5 ? "5+" : String(d)]++;
  }
  const top = (list: PageItem[], fn: (p: PageItem) => number, n = 15, asc = false) =>
    list.map((p) => ({ url: p.url, value: fn(p) })).filter((x) => Number.isFinite(x.value)).sort((a, b) => (asc ? a.value - b.value : b.value - a.value)).slice(0, n);
  const deepPages = top(ok.filter((p) => (p.click_depth ?? 0) > 3), (p) => p.click_depth ?? 0);
  const inbound = (p: PageItem) => (p.checks?.is_orphan_page ? 0 : p.meta?.inbound_links_count ?? 0);
  const weakLinked = top(ok.filter((p) => norm(p.url) !== norm(home) && inbound(p) <= 1), inbound, 25, true);
  const slowPages = top(ok.filter((p) => (p.page_timing?.duration_time ?? 0) > 1500), (p) => p.page_timing?.duration_time ?? 0, 10);
  const heavyPages = top(ok.filter((p) => (p.size ?? 0) > 500_000), (p) => p.size ?? 0, 10);
  const thinPages = top(ok.filter((p) => (p.meta?.content?.plain_text_word_count ?? 0) < 300), (p) => p.meta?.content?.plain_text_word_count ?? 0, 20, true);
  const lowScorePages = top(ok.filter((p) => p.onpage_score != null), (p) => Math.round(p.onpage_score ?? 0), 10, true);
  const bigImages = (imagesRes[0]?.items ?? []).map((i) => ({ url: i.url, value: i.size ?? i.total_transfer_size ?? 0 })).slice(0, 15);

  // 4) Indexing vs Search Console.
  let indexing: CrawlDeep["indexing"] = null;
  let gscState: CrawlDeep["gscState"] = gscLinked ? "ok" : "not_linked";
  const sameSite = (gscPages ?? []).some((r) => norm(r.keys[0]).startsWith(crawl.target.toLowerCase()));
  if (gscLinked && gscPages && !gscPages.length) {
    gscState = "no_data";
    notes.push("Search Console returned no data for the last 28 days, so Google visibility wasn't scored. Check the property on the Google page.");
  } else if (gscPages?.length && !sameSite) {
    gscState = "mismatch";
    notes.push(`The linked Search Console property doesn't match ${crawl.target}, so Google visibility wasn't scored. Pick the right property on the Google page.`);
  } else if (gscPages) {
    const imp = new Map(gscPages.map((r) => [norm(r.keys[0]), r.impressions]));
    const crawled = new Set(ok.map((p) => norm(p.url)));
    const noImp = ok.filter((p) => !imp.get(norm(p.url))).map((p) => ({ url: p.url, value: p.meta?.inbound_links_count ?? 0 }));
    const notCrawled = gscPages.filter((r) => r.impressions >= 10 && !crawled.has(norm(r.keys[0])) && !r.keys[0].includes("#")).sort((a, b) => b.impressions - a.impressions).slice(0, 15).map((r) => ({ url: r.keys[0], value: r.impressions }));
    indexing = { gsc: true, crawledOk: ok.length, withImpressions: ok.length - noImp.length, noImpressions: noImp.slice(0, 25), notCrawled };
  } else if (!gscLinked) notes.push("Search Console isn't linked for this client, so Google visibility and cannibalisation weren't checked.");
  if (speed.length && !speed.some((x) => x.mobile.field)) notes.push("Google has no real-user (Chrome UX) speed data for this site yet; it needs more Chrome traffic. Lab scores are used instead.");

  // 5) Cannibalisation: one query, several of our pages each getting a real share of impressions.
  const cannibal: Cannibal[] = [];
  if (gscQP && gscState === "ok") {
    const byQ = new Map<string, { url: string; clicks: number; impressions: number; position: number }[]>();
    for (const r of gscQP) { const [q, page] = r.keys; if (page.includes("#")) continue; (byQ.get(q) ?? byQ.set(q, []).get(q)!).push({ url: page, clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 }); }
    for (const [query, list] of byQ) {
      const total = list.reduce((s, x) => s + x.impressions, 0);
      const real = list.filter((x) => x.impressions >= 5 && x.impressions / total >= 0.1);
      if (real.length >= 2 && total >= 30) cannibal.push({ query, impressions: total, pages: real.sort((a, b) => b.impressions - a.impressions).slice(0, 4) });
    }
    cannibal.sort((a, b) => b.impressions - a.impressions).splice(15);
  }

  // 6) Category scores.
  const mob = speed.map((s) => s.mobile.performance).filter((v): v is number => v != null);
  const perf = mob.length ? mob.reduce((a, b) => a + b, 0) / mob.length : null;
  const n = Math.max(1, ok.length);
  const issues = (crawl.issues as unknown as CrawlIssue[] | null) ?? [];
  const errPages = issues.filter((i) => i.severity === "error").reduce((s, i) => s + i.count, 0);
  const secCount = sec ? Object.values(sec.headers).filter(Boolean).length : 0;
  const categories: Category[] = [
    { key: "technical", label: "Technical health", score: clamp(crawl.score ?? 0), note: `${errPages} error${errPages === 1 ? "" : "s"} across ${crawl.pagesCrawled} pages` },
    ...(perf != null ? [{ key: "speed", label: "Speed (mobile)", score: clamp(perf), note: `PageSpeed average of ${mob.length} page${mob.length === 1 ? "" : "s"}` }] : []),
    { key: "content", label: "Content depth", score: clamp(100 - (thinPages.length / n) * 150), note: `${thinPages.length} thin page${thinPages.length === 1 ? "" : "s"} under 300 words` },
    { key: "links", label: "Internal linking", score: clamp(100 - ((weakLinked.length + deepPages.length) / n) * 120), note: `${weakLinked.length} weakly linked, ${deepPages.length} buried deeper than 3 clicks` },
    ...(indexing ? [{ key: "indexing", label: "Visibility in Google", score: clamp((indexing.withImpressions / Math.max(1, indexing.crawledOk)) * 100), note: `${indexing.withImpressions} of ${indexing.crawledOk} pages got Google impressions (28 days)` }] : []),
    ...(aiReady(files, schema) ?? []),
    ...(sec ? [{ key: "security", label: "Security", score: clamp((sec.https ? 40 : 0) + (secCount / 6) * 60 - sec.mixedContent.length * 5), note: `${secCount} of 6 security headers${sec.mixedContent.length ? `, ${sec.mixedContent.length} insecure files` : ""}` }] : []),
  ];
  const weights: Record<string, number> = { technical: 3, speed: 2, content: 1.5, links: 1.5, indexing: 2, ai: 1, security: 1 };
  const overall = clamp(categories.reduce((s, c) => s + c.score * (weights[c.key] ?? 1), 0) / categories.reduce((s, c) => s + (weights[c.key] ?? 1), 0));

  const deep: CrawlDeep = {
    version: DEEP_VERSION, gscState, files, schema, hreflang, keywords, template, market,
    generatedAt: new Date().toISOString(), overall, categories, speed, status, depth, deepPages, weakLinked, slowPages, heavyPages,
    thinPages, lowScorePages, bigImages, indexing, cannibal, security: sec, ai: null, notes,
  };

  // 7) AI executive summary + prioritised plan.
  if (geminiConfigured()) {
    try {
      deep.ai = await aiPlan(deep, issues, { name: client.name, type: client.businessType, city: client.primaryCity, target: crawl.target, pages: crawl.pagesCrawled });
    } catch (e) {
      notes.push(`AI summary: ${e instanceof Error ? e.message : e}`);
    }
  }

  await db.siteCrawl.update({ where: { id: crawl.id }, data: { advanced: deep as unknown as Prisma.InputJsonValue, advancedAt: new Date(), advancedError: null } });
  return deep;
}

async function aiPlan(d: CrawlDeep, issues: CrawlIssue[], c: { name: string; type: string | null; city: string | null; target: string; pages: number }) {
  const ms = (v: number | null | undefined) => (v == null ? "n/a" : `${(v / 1000).toFixed(1)}s`);
  const facts = [
    `Site: ${c.target} — ${c.name}${c.type ? `, ${c.type}` : ""}${c.city ? `, ${c.city}` : ""}. ${c.pages} pages crawled. Overall score ${d.overall}/100.`,
    `Category scores: ${d.categories.map((x) => `${x.label} ${x.score} (${x.note})`).join("; ")}.`,
    `Issues: ${issues.slice(0, 25).map((i) => `[${i.severity}] ${i.title}: ${i.count} pages`).join("; ")}.`,
    `Speed: ${d.speed.map((s) => `${s.url} mobile ${s.mobile.performance ?? "?"} / desktop ${s.desktop.performance ?? "?"}, lab LCP ${ms(s.mobile.lcpMs)}, CLS ${s.mobile.cls?.toFixed(2) ?? "?"}${s.mobile.field ? `, real users LCP ${ms(s.mobile.field.lcpMs)} INP ${s.mobile.field.inpMs ?? "?"}ms (${s.mobile.field.overall})` : ""}; biggest savings: ${(s.mobile.opportunities ?? []).slice(0, 3).map((o) => `${o.title} (${ms(o.savingsMs)})`).join(", ")}`).join(" | ")}.`,
    `Click depth (pages per number of clicks from home; "none" = only found via the sitemap, no internal link path): ${JSON.stringify(d.depth)}. Weakly linked pages: ${d.weakLinked.length}. Thin pages: ${d.thinPages.length}. Heavy pages >500KB: ${d.heavyPages.length}. Images >200KB: ${d.bigImages.length}.`,
    d.gscState && d.gscState !== "ok" ? `Search Console data is NOT available (${d.gscState === "not_linked" ? "not linked" : d.gscState === "no_data" ? "returned no rows" : "property doesn't match the site"}). Do not say anything about Google visibility, impressions or indexing; at most recommend linking Search Console.` : "",
    d.files ? `Sitemap: ${d.files.sitemaps.length ? `${d.files.sitemapUrls} URLs` : "none found"}; ${d.files.sitemapBad.length} sitemap URLs redirect or error; ${d.files.notInSitemap.length} live pages missing from the sitemap. robots.txt ${d.files.robots ? "found" : "missing"}. AI crawlers blocked: ${d.files.aiBotsBlocked.join(", ") || "none"}. llms.txt: ${d.files.llmsTxt ? "yes" : "no"}.` : "",
    d.schema?.length ? `Structured data: ${d.schema.map((p) => `${p.url.replace(/^https?:\/\/[^/]+/, "") || "/"} [${p.types.join(", ") || "none"}]`).join("; ")}.` : "",
    d.hreflang ? (d.hreflang.multiLangNoTags ? `Multi-language site (${d.hreflang.langs.join(", ")}) without hreflang tags.` : `hreflang: ${d.hreflang.pages} key pages tagged, languages ${d.hreflang.langs.join(", ")}; problems: ${d.hreflang.problems.slice(0, 6).map((p) => p.problem).join("; ") || "none"}.`) : "",
    d.keywords?.length ? `Home page keyword consistency (word: count, in title/meta/headings): ${d.keywords.map((k) => `${k.word}: ${k.count} ${k.title ? "T" : "-"}${k.description ? "M" : "-"}${k.headings ? "H" : "-"}`).join(", ")}.` : "",
    d.template ? `Templated pages: ${d.template.checked} similar-looking location/service pages checked, average ${d.template.avgPct}% text shared with the most similar page; most duplicated: ${d.template.pages.slice(0, 4).map((p) => `${p.url.replace(/^https?:\/\/[^/]+/, "")} ${p.pct}%`).join(", ")}.` : "",
    d.files?.newestPost ? `Newest blog post in sitemap: ${d.files.newestPost.date}.` : "",
    d.market ? `Off-page: authority ${d.market.authority ?? "n/a"}/100, ${d.market.referringDomains ?? "n/a"} referring domains, ${d.market.backlinks ?? "n/a"} backlinks; organic traffic ~${d.market.traffic ?? "n/a"}/month from ${d.market.keywords ?? "n/a"} keywords (${d.market.top10 ?? "n/a"} in top 10). Competitors: ${d.market.competitors.filter((c) => !c.you).map((c) => `${c.domain} (traffic ${c.traffic ?? "?"}, keywords ${c.keywords ?? "?"})`).join("; ") || "unknown"}.${d.market.history.length > 2 ? ` Backlinks 12 months ago ${d.market.history[0].backlinks}, now ${d.market.history[d.market.history.length - 1].backlinks}.` : ""}` : "",
    d.indexing ? `Google visibility: ${d.indexing.withImpressions}/${d.indexing.crawledOk} crawled pages had impressions in 28 days; ${d.indexing.notCrawled.length} pages get impressions but weren't found by the crawl (old URLs or orphans).` : "",
    d.cannibal.length ? `Keyword cannibalisation: ${d.cannibal.slice(0, 5).map((x) => `"${x.query}" split across ${x.pages.length} pages`).join("; ")}.` : "",
    d.security ? `Security: HTTPS ${d.security.https ? "yes" : "no"}; missing headers: ${Object.entries(d.security.headers).filter(([, v]) => !v).map(([k]) => k).join(", ") || "none"}; insecure files: ${d.security.mixedContent.length}.` : "",
  ].filter(Boolean).join("\n");
  type Raw = { summary: string; strengths: string[]; actions: Action[]; quickWins: string[]; sections?: Record<string, Section>; roadmap?: RoadmapMonth[]; conclusion?: string };
  const r = await geminiJson<Raw>(facts, {
    system: `You are a senior SEO consultant writing the executive summary of a technical SEO audit for a business owner (not technical).
Return JSON: {"summary": string, "strengths": string[], "actions": [{"title": string, "why": string, "impact": "high"|"medium"|"low", "effort": string, "category": string}], "quickWins": string[],
 "sections": {"onpage"|"content"|"images"|"speed"|"technical"|"offpage"|"ai": {"description": string[], "fix": string[]}},
 "roadmap": [{"month": number, "focus": string, "tasks": string, "outcome": string}], "conclusion": string}
- summary: 4–6 sentences, plain English: overall state, the 2–3 biggest problems and what fixing them will do for rankings and leads. Use the real numbers.
- strengths: 2–4 things the site already does well.
- actions: the 10 most valuable website fixes in priority order (highest impact for the least effort first). title is an imperative ("Compress the 14 largest images"); why is one sentence with the number; effort like "1 hour", "half a day", "developer, 2 days"; category one of Technical, Speed, Content, Internal links, Indexing, AI search, Security.
- quickWins: 3–5 things that take under 30 minutes each.
- sections: for each of onpage (titles, meta, H1, keyword consistency), content (thin, templated/duplicate, blog freshness, cannibalisation), images (alt text, image size, social share images), speed (PageSpeed, Core Web Vitals), technical (broken links, redirects, canonicals, sitemap, robots, security, internal links), offpage (authority, backlinks, competitors) and ai (AI search readiness): 2–3 short "description" sentences with the real numbers, and 2–3 matching "fix" sentences. Skip a section only if there is no data at all.
- roadmap: exactly 6 months, front-loading quick high-impact technical fixes, then speed, on-page, content, and authority/AI. focus 2–4 words; tasks one sentence listing the concrete tasks; outcome 3–8 words.
- conclusion: 2–3 sentences for the end of the report.
Only use the facts given. No invented numbers.`,
    timeoutMs: 100_000, temperature: 0.3,
  });
  const impacts = new Set(["high", "medium", "low"]);
  return {
    summary: String(r.summary ?? ""),
    strengths: (r.strengths ?? []).map(String).slice(0, 4),
    actions: (r.actions ?? []).slice(0, 10).map((a) => ({ title: String(a.title ?? ""), why: String(a.why ?? ""), impact: (impacts.has(a.impact) ? a.impact : "medium") as Action["impact"], effort: String(a.effort ?? ""), category: String(a.category ?? "") })),
    quickWins: (r.quickWins ?? []).map(String).slice(0, 5),
    sections: Object.fromEntries(Object.entries(r.sections ?? {}).filter(([k]) => ["onpage", "content", "images", "speed", "technical", "offpage", "ai"].includes(k))
      .map(([k, v]) => [k, { description: (v?.description ?? []).map(String).slice(0, 4), fix: (v?.fix ?? []).map(String).slice(0, 4) }])) as Partial<Record<SectionKey, Section>>,
    roadmap: (r.roadmap ?? []).slice(0, 6).map((m, i) => ({ month: Number(m.month) || i + 1, focus: String(m.focus ?? ""), tasks: String(m.tasks ?? ""), outcome: String(m.outcome ?? "") })),
    conclusion: String(r.conclusion ?? ""),
  };
}

/** Starts the deep analysis once per crawl (or again when forced). Returns false when it's already running. */
export async function claimDeep(crawlId: string, force = false) {
  const stale = new Date(Date.now() - 6 * 60_000);
  const r = await db.siteCrawl.updateMany({
    where: { id: crawlId, status: "DONE", ...(force ? { OR: [{ advancedStartedAt: null }, { advancedStartedAt: { lt: stale } }, { advancedAt: { not: null } }] } : { advancedAt: null, OR: [{ advancedStartedAt: null }, { advancedStartedAt: { lt: stale } }] }) },
    data: { advancedStartedAt: new Date(), advancedError: null, ...(force ? { advancedAt: null } : {}) },
  });
  return r.count > 0;
}

export async function runDeepSafe(crawlId: string, refresh = false) {
  let crawl = await db.siteCrawl.findUniqueOrThrow({ where: { id: crawlId } });
  try {
    // A re-run (or a report from an older version) also rebuilds the issue list with the latest checks.
    if (refresh) crawl = await refreshIssues(crawl).catch(() => crawl);
    await runDeep(crawl);
  } catch (e) {
    await db.siteCrawl.update({ where: { id: crawlId }, data: { advancedError: e instanceof Error ? e.message : String(e), advancedAt: new Date() } });
  }
}
