/**
 * Content score vs Google's top 10: fetch the organic top 10 for the focus keyword (DataForSEO SERP),
 * read those pages, and compare the draft's length, headings and terms with them.
 */
import { parse } from "node-html-parser";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { dfsPost, dataforseoConfigured } from "./dataforseo";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CACHE_DAYS = 14;
const SKIP_HOSTS = /(^|\.)(youtube\.com|facebook\.com|instagram\.com|tiktok\.com|pinterest\.com|linkedin\.com|x\.com|twitter\.com|amazon\.[a-z.]+)$/i;

const STOP = new Set("a an the and or but if then than so of to in on at by for with from as is are was were be been being it its this that these those you your yours we our us they their them he she his her i me my not no yes do does did done can could will would should may might must have has had having about into over under up down out more most less very just also only any some all each other such what which who whom when where why how there here get got make made use used one two three new like well even back after before while during per via vs etc need needs needed want wants keep keeps take takes find help helps go goes see know way lot lots".split(" "));

export type Competitor = { url: string; title: string; position: number; words: number; h2: string[]; ok: boolean };
export type Term = { term: string; pages: number; avg: number };
export type SerpBenchmark = { keyword: string; location: string; fetchedAt: string; competitors: Competitor[]; terms: Term[]; medianWords: number; medianH2: number; headings: string[] };
export type ContentScore = {
  score: number;
  words: number;
  targetWords: [number, number];
  h2: number;
  targetH2: number;
  terms: (Term & { used: number })[];
  missing: string[];
  headings: string[];
  competitors: Competitor[];
  fetchedAt: string;
  location: string;
};

const clean = (html: string) => html.replace(/<(script|style|noscript|svg|nav|header|footer|form|aside|iframe)[\s\S]*?<\/\1>/gi, " ");
const tokens = (text: string) => text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w && !/^\d+$/.test(w) && w.length > 1);

function grams(text: string) {
  const counts = new Map<string, number>();
  const add = (g: string) => counts.set(g, (counts.get(g) ?? 0) + 1);
  // Phrases never cross a sentence or clause boundary.
  for (const seg of text.split(/[.!?,;:()\[\]"“”|\n•·–—]+/)) {
    const t = tokens(seg);
    for (let i = 0; i < t.length; i++) {
      if (!STOP.has(t[i]) && t[i].length > 2) add(t[i]);
      if (i + 1 < t.length && !STOP.has(t[i]) && !STOP.has(t[i + 1])) add(`${t[i]} ${t[i + 1]}`);
      if (i + 2 < t.length && !STOP.has(t[i]) && !STOP.has(t[i + 2])) add(`${t[i]} ${t[i + 1]} ${t[i + 2]}`);
    }
  }
  return counts;
}

function readPage(html: string) {
  const root = parse(clean(html));
  const main = root.querySelector("article") ?? root.querySelector("main") ?? root.querySelector("[role=main]") ?? root.querySelector("body") ?? root;
  const text = main.structuredText.replace(/[ \t]+/g, " ").trim();
  return { text, words: tokens(text).length, h2: main.querySelectorAll("h2").map((h) => h.textContent.replace(/\s+/g, " ").trim()).filter((h) => h && h.length < 120).slice(0, 20) };
}

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

async function fetchBenchmark(keyword: string, location: string, ownSite: string): Promise<SerpBenchmark> {
  type Item = { type: string; rank_absolute: number; url: string; title: string };
  const res = await dfsPost<{ items?: Item[] }>("serp/google/organic/live/regular", [{ keyword, location_name: location, language_code: "en", depth: 20 }]);
  const own = host(ownSite);
  const organic = (res[0]?.items ?? []).filter((i) => i.type === "organic" && i.url && !SKIP_HOSTS.test(host(i.url)) && (!own || host(i.url) !== own)).slice(0, 10);

  const pages = await Promise.all(organic.map(async (o) => {
    try {
      const r = await fetch(o.url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(9000) });
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("html")) throw new Error("not html");
      const html = (await r.text()).slice(0, 1_500_000);
      return { o, page: readPage(html) };
    } catch {
      return { o, page: null };
    }
  }));
  const ok = pages.filter((p) => p.page && p.page.words > 150);
  const df = new Map<string, { pages: number; total: number }>();
  for (const p of ok) {
    for (const [g, n] of grams(p.page!.text)) {
      const e = df.get(g) ?? { pages: 0, total: 0 };
      e.pages++; e.total += n; df.set(g, e);
    }
  }
  const minPages = Math.max(2, Math.ceil(ok.length * 0.4));
  const kwTokens = new Set(tokens(keyword));
  const size = (t: string) => t.split(" ").length;
  const weight = (t: string) => (size(t) === 2 ? 1.25 : size(t) === 3 ? 1.1 : 1);
  const terms = [...df]
    .filter(([term, v]) => v.pages >= (size(term) === 3 ? Math.max(minPages, Math.ceil(ok.length * 0.6)) : minPages))
    .map(([term, v]) => ({ term, pages: v.pages, avg: Math.max(1, Math.round(v.total / v.pages)) }))
    .sort((a, b) => b.pages * weight(b.term) - a.pages * weight(a.term) || b.avg - a.avg);
  const kept: Term[] = [];
  let singles = 0;
  for (const t of terms) {
    if (kept.length >= 35) break;
    if (size(t.term) === 1 && (kwTokens.has(t.term) || singles >= 12)) continue;
    // Skip a phrase already covered by a kept one (inside it, or containing it) seen on as many pages.
    if (kept.some((k) => (k.term.includes(t.term) || t.term.includes(k.term)) && k.pages >= t.pages)) continue;
    kept.push(t);
    if (size(t.term) === 1) singles++;
  }
  const allH2 = ok.flatMap((p) => p.page!.h2);
  const seen = new Set<string>();
  const headings = allH2.filter((h) => { const k = tokens(h).filter((w) => !STOP.has(w)).sort().join(" "); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 25);
  return {
    keyword, location, fetchedAt: new Date().toISOString(),
    competitors: pages.map(({ o, page }) => ({ url: o.url, title: o.title, position: o.rank_absolute, words: page?.words ?? 0, h2: page?.h2.slice(0, 8) ?? [], ok: !!page && page.words > 150 })),
    terms: kept, medianWords: median(ok.map((p) => p.page!.words)), medianH2: median(ok.map((p) => p.page!.h2.length)), headings,
  };
}

/** Top-10 benchmark for a client's keyword, cached for two weeks. */
export async function getBenchmark(clientId: string, keyword: string, opts: { refresh?: boolean } = {}) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { targetCountry: true, siteUrl: true } });
  const location = client.targetCountry?.trim() || process.env.DATAFORSEO_DEFAULT_COUNTRY || "United States";
  const kw = keyword.trim().toLowerCase();
  if (!opts.refresh) {
    const hit = await db.serpBenchmark.findUnique({ where: { keyword_location: { keyword: kw, location } } });
    if (hit && Date.now() - hit.fetchedAt.getTime() < CACHE_DAYS * 864e5) return hit.data as unknown as SerpBenchmark;
  }
  const data = await fetchBenchmark(kw, location, client.siteUrl);
  await db.serpBenchmark.upsert({
    where: { keyword_location: { keyword: kw, location } },
    create: { keyword: kw, location, data: data as unknown as Prisma.InputJsonValue },
    update: { data: data as unknown as Prisma.InputJsonValue, fetchedAt: new Date() },
  });
  return data;
}

const countIn = (text: string, term: string) => {
  const t = ` ${tokens(text).join(" ")} `;
  let n = 0, i = 0;
  const k = ` ${term} `;
  while ((i = t.indexOf(k, i)) !== -1) { n++; i += k.length - 1; }
  return n;
};

/** Scores a draft against a benchmark: terms 60%, length 25%, headings 15%. */
export function scoreContent(bodyHtml: string, b: SerpBenchmark): ContentScore {
  const page = readPage(bodyHtml.replace(/<style[\s\S]*?<\/style>/gi, ""));
  const terms = b.terms.map((t) => ({ ...t, used: countIn(page.text, t.term) }));
  const weightSum = terms.reduce((n, t) => n + t.pages, 0) || 1;
  const termScore = terms.reduce((n, t) => n + (t.used > 0 ? t.pages : 0), 0) / weightSum;
  const lo = Math.round(b.medianWords * 0.85), hi = Math.round(Math.max(b.medianWords * 1.25, b.medianWords + 300));
  const lenScore = !b.medianWords ? 1 : page.words >= lo && page.words <= hi * 1.3 ? 1 : page.words < lo ? Math.max(0, page.words / lo) : 0.8;
  const target = Math.max(3, b.medianH2);
  const h2Score = Math.min(1, page.h2.length / target);
  return {
    score: Math.round((termScore * 0.6 + lenScore * 0.25 + h2Score * 0.15) * 100),
    words: page.words, targetWords: [lo, hi], h2: page.h2.length, targetH2: target,
    terms, missing: terms.filter((t) => t.used === 0).map((t) => t.term), headings: b.headings,
    competitors: b.competitors, fetchedAt: b.fetchedAt, location: b.location,
  };
}

/** Runs (or refreshes) the content score for one article and stores it. */
export async function runContentScore(articleId: string, opts: { refresh?: boolean } = {}) {
  if (!dataforseoConfigured()) throw new Error("Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel first");
  const a = await db.article.findUniqueOrThrow({ where: { id: articleId }, select: { clientId: true, focusKeyword: true, bodyHtml: true } });
  if (!a.focusKeyword.trim()) throw new Error("This article has no focus keyword");
  const b = await getBenchmark(a.clientId, a.focusKeyword, opts);
  if (!b.competitors.some((c) => c.ok)) throw new Error("Couldn't read any of the top 10 pages for this keyword");
  const result = scoreContent(a.bodyHtml, b);
  await db.article.update({ where: { id: articleId }, data: { contentScore: result.score, contentReport: result as unknown as Prisma.InputJsonValue, contentCheckedAt: new Date() } });
  return result;
}

/** Re-scores against the cached benchmark only (no API call), e.g. after an edit. */
export async function rescoreContent(articleId: string) {
  const a = await db.article.findUniqueOrThrow({ where: { id: articleId }, select: { bodyHtml: true, contentReport: true, focusKeyword: true } });
  const prev = a.contentReport as unknown as ContentScore | null;
  if (!prev) return null;
  const hit = await db.serpBenchmark.findUnique({ where: { keyword_location: { keyword: a.focusKeyword.trim().toLowerCase(), location: prev.location } } });
  if (!hit) return null;
  const result = scoreContent(a.bodyHtml, hit.data as unknown as SerpBenchmark);
  await db.article.update({ where: { id: articleId }, data: { contentScore: result.score, contentReport: result as unknown as Prisma.InputJsonValue, contentCheckedAt: new Date() } });
  return result;
}
