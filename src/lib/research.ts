/**
 * SOP Step 1 (research before writing), done automatically for n8n:
 * Google top results for the focus keyword (skipping directories, forums and marketplaces),
 * the People Also Ask questions, each competitor page's headings, and the keywords those pages rank for.
 * Cached for 14 days per keyword and location.
 */
import { parse } from "node-html-parser";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { dfsPost } from "./dataforseo";
import { rankLocation } from "./rank";
import { geminiConfigured, geminiJson } from "./gemini";

const CACHE_DAYS = 14;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
// Directories, forums, marketplaces and social sites: not "competitor articles" per the SOP.
const SKIP = /(^|\.)(yelp|angi|angieslist|homeadvisor|thumbtack|yellowpages|bbb|mapquest|nextdoor|houzz|porch|bark|expertise|threebestrated|reddit|quora|facebook|instagram|tiktok|pinterest|linkedin|x|twitter|youtube|amazon|ebay|etsy|walmart|homedepot|lowes|craigslist|indeed|glassdoor|tripadvisor|google|wikipedia)\.[a-z.]+$/i;
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

export type ResearchCompetitor = { url: string; title: string; position: number; words: number; h2: string[]; h3: string[]; review?: string; excerpt?: string; keywords: { keyword: string; volume: number | null; position: number | null }[] };
export type Research = { keyword: string; location: string; fetchedAt: string; competitors: ResearchCompetitor[]; paa: string[]; secondaryKeywords: { keyword: string; volume: number | null; competitors: number }[]; relatedSearches: string[]; gaps?: string[]; plan?: HeadingPlan };
/** SOP Step 3: which keywords and PAA questions go in the subheadings, and which PAA questions are left for the FAQ. */
export type HeadingPlan = { secondaryForHeadings: string[]; paaForHeadings: string[]; paaForFaq: string[] };

async function readHeadings(url: string) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(9000) });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("html")) return null;
    const root = parse((await r.text()).slice(0, 1_500_000).replace(/<(script|style|noscript|svg|nav|header|footer|form|aside|iframe)[\s\S]*?<\/\1>/gi, " "));
    const t = (s: string) => s.replace(/\s+/g, " ").trim();
    const main = root.querySelector("article") ?? root.querySelector("main") ?? root;
    return {
      h2: main.querySelectorAll("h2").map((h) => t(h.textContent)).filter(Boolean).slice(0, 20),
      h3: main.querySelectorAll("h3").map((h) => t(h.textContent)).filter(Boolean).slice(0, 25),
      words: t(main.textContent).split(" ").length,
      excerpt: t(main.textContent).slice(0, 2500),
    };
  } catch {
    return null;
  }
}

async function rankedKeywords(url: string, country: string) {
  type Item = { keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number | null } }; ranked_serp_element?: { serp_item?: { rank_group?: number } } };
  try {
    const res = await dfsPost<{ items?: Item[] }>("dataforseo_labs/google/ranked_keywords/live", [{ target: url, location_name: country, language_code: "en", limit: 40, order_by: ["keyword_data.keyword_info.search_volume,desc"] }], 40_000);
    return (res[0]?.items ?? []).map((i) => ({ keyword: (i.keyword_data?.keyword ?? "").toLowerCase(), volume: i.keyword_data?.keyword_info?.search_volume ?? null, position: i.ranked_serp_element?.serp_item?.rank_group ?? null })).filter((k) => k.keyword);
  } catch {
    return [];
  }
}

async function fetchResearch(keyword: string, clientId: string): Promise<Research> {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { siteUrl: true, targetCountry: true } });
  const loc = await rankLocation(clientId);
  const country = client.targetCountry?.trim() || process.env.DATAFORSEO_DEFAULT_COUNTRY || "United States";
  type Serp = { type: string; rank_group?: number; url?: string; title?: string; items?: { title?: string; type?: string }[] };
  const serp = await dfsPost<{ items?: Serp[] }>("serp/google/organic/live/advanced", [{ keyword, language_code: "en", depth: 20, people_also_ask_click_depth: 1, ...(loc.location_coordinate ? { location_coordinate: loc.location_coordinate } : { location_name: loc.location_name }) }], 55_000);
  const items = serp[0]?.items ?? [];
  const own = host(client.siteUrl);
  const organic = items.filter((i) => i.type === "organic" && i.url && !SKIP.test(host(i.url)) && host(i.url) !== own).slice(0, 4);
  const paa = [...new Set(items.filter((i) => i.type === "people_also_ask").flatMap((i) => (i.items ?? []).map((q) => (q.title ?? "").trim())).filter(Boolean))].slice(0, 12);
  const relatedSearches = [...new Set(items.filter((i) => i.type === "related_searches").flatMap((i) => (i.items ?? []).map((q) => (typeof q === "string" ? q : q.title ?? "").trim())).filter(Boolean))].slice(0, 10);

  const competitors: ResearchCompetitor[] = await Promise.all(organic.map(async (o) => {
    const [page, kws] = await Promise.all([readHeadings(o.url!), rankedKeywords(o.url!, country)]);
    return { url: o.url!, title: o.title ?? "", position: o.rank_group ?? 0, words: page?.words ?? 0, h2: page?.h2 ?? [], h3: page?.h3 ?? [], excerpt: page?.excerpt ?? "", keywords: kws.slice(0, 25) };
  }));

  // Secondary keywords: what the competitor pages rank for, preferring terms several of them share, then volume.
  const focus = keyword.trim().toLowerCase();
  const tally = new Map<string, { volume: number | null; competitors: number }>();
  for (const c of competitors) for (const k of new Map(c.keywords.map((x) => [x.keyword, x])).values()) {
    if (k.keyword === focus) continue;
    const e = tally.get(k.keyword) ?? { volume: k.volume, competitors: 0 };
    e.competitors++; tally.set(k.keyword, e);
  }
  const secondaryKeywords = [...tally].map(([kw, v]) => ({ keyword: kw, ...v })).sort((a, b) => b.competitors - a.competitors || (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 10);
  const { gaps } = await reviewCompetitors(focus, competitors);
  for (const c of competitors) delete c.excerpt;
  return { keyword: focus, location: loc.label, fetchedAt: new Date().toISOString(), competitors, paa, secondaryKeywords, relatedSearches, gaps, plan: headingPlan(paa, secondaryKeywords.map((k) => k.keyword)) };
}

/** PAA questions go in subheadings first, keeping at least 5 for the FAQ (SOP Steps 3 and 6). */
export function headingPlan(paa: string[], secondary: string[]): HeadingPlan {
  const forHeadings = Math.min(4, Math.max(paa.length >= 6 ? 2 : paa.length >= 4 ? 1 : 0, paa.length - 5));
  return { secondaryForHeadings: secondary.slice(0, 5), paaForHeadings: paa.slice(0, forHeadings), paaForFaq: paa.slice(forHeadings) };
}

/** SOP Step 1.3: a 3–4 line review of each competitor article (what it covers well, what it misses), from its headings and text. */
async function reviewCompetitors(keyword: string, comps: ResearchCompetitor[]) {
  if (!comps.length || !geminiConfigured()) return { gaps: [] as string[] };
  try {
    const out = await geminiJson<{ reviews: { n: number; review: string }[]; gaps: string[] }>(
      `Focus keyword: "${keyword}"\n\n${comps.map((c, i) => `COMPETITOR ${i + 1}: ${c.title} (${c.url}), Google #${c.position}, about ${c.words} words\nH2s: ${c.h2.join(" | ") || "(none)"}\nH3s: ${c.h3.slice(0, 15).join(" | ") || "(none)"}\nText: ${(c.excerpt ?? "").slice(0, 2000)}`).join("\n\n")}`,
      {
        system: `You review competitor blog posts for an SEO writer before they write their own post on the same keyword.
For each competitor write a review of 3–4 sentences in plain English: what the article covers, what it answers well, and what it misses or answers weakly. Only state what you can see in the headings and text given. No fluff.
Then list up to 6 "gaps": topics or questions none of them answer well that our post should cover, still on the focus keyword.
Return JSON: {"reviews":[{"n":1,"review":"..."}],"gaps":["..."]}`,
        timeoutMs: 40_000,
      },
    );
    for (const r of out.reviews ?? []) if (comps[r.n - 1] && r.review) comps[r.n - 1].review = r.review.trim();
    return { gaps: (out.gaps ?? []).filter(Boolean).slice(0, 6) };
  } catch {
    return { gaps: [] as string[] };
  }
}

/** Research already saved for this keyword (never calls DataForSEO). */
export async function cachedResearch(clientId: string, keyword: string) {
  const loc = (await rankLocation(clientId)).label;
  const hit = await db.serpBenchmark.findUnique({ where: { keyword_location: { keyword: `research:${keyword.trim().toLowerCase()}`, location: loc } } });
  return hit ? (hit.data as unknown as Research) : null;
}

export async function getResearch(clientId: string, keyword: string, opts: { refresh?: boolean } = {}) {
  const kw = keyword.trim().toLowerCase();
  const loc = (await rankLocation(clientId)).label;
  const key = { keyword: `research:${kw}`, location: loc };
  if (!opts.refresh) {
    const hit = await db.serpBenchmark.findUnique({ where: { keyword_location: key } });
    if (hit && Date.now() - hit.fetchedAt.getTime() < CACHE_DAYS * 864e5) return hit.data as unknown as Research;
  }
  const data = await fetchResearch(kw, clientId);
  await db.serpBenchmark.upsert({ where: { keyword_location: key }, create: { ...key, data: data as unknown as Prisma.InputJsonValue }, update: { data: data as unknown as Prisma.InputJsonValue, fetchedAt: new Date() } });
  return data;
}

/** Plain-text research notes for the AI brief and writer. */
export function researchBrief(r: Research) {
  const lines = [`RESEARCH (Google, ${r.location}, ${r.fetchedAt.slice(0, 10)}) for "${r.keyword}"`];
  r.competitors.forEach((c, i) => {
    lines.push(`\nCompetitor ${i + 1}: #${c.position} ${c.title} (${c.url})${c.words ? `, about ${c.words} words` : ""}`);
    if (c.review) lines.push(`  Review: ${c.review}`);
    if (c.h2.length) lines.push(`  H2s: ${c.h2.join(" | ")}`);
    if (c.h3.length) lines.push(`  H3s: ${c.h3.slice(0, 15).join(" | ")}`);
    if (c.keywords.length) lines.push(`  Ranks for: ${c.keywords.slice(0, 12).map((k) => k.keyword).join(", ")}`);
  });
  if (r.secondaryKeywords.length) lines.push(`\nSECONDARY KEYWORDS (from competitors): ${r.secondaryKeywords.map((k) => `${k.keyword}${k.volume ? ` (${k.volume}/mo)` : ""}`).join(", ")}`);
  if (r.paa.length) lines.push(`\nPEOPLE ALSO ASK:\n${r.paa.map((q) => `- ${q}`).join("\n")}`);
  if (r.relatedSearches.length) lines.push(`\nRELATED SEARCHES: ${r.relatedSearches.join(", ")}`);
  if (r.gaps?.length) lines.push(`\nWHAT THE COMPETITORS MISS (cover these):\n${r.gaps.map((g) => `- ${g}`).join("\n")}`);
  const plan = r.plan ?? headingPlan(r.paa, r.secondaryKeywords.map((k) => k.keyword));
  lines.push(`\nHEADING PLAN (SOP Step 3)`);
  if (plan.secondaryForHeadings.length) lines.push(`- Use each of these competitor keywords in an H2 or H3 (one per heading): ${plan.secondaryForHeadings.join(", ")}`);
  if (plan.paaForHeadings.length) lines.push(`- Use these People Also Ask questions (or their keywords) as H2/H3 subheadings: ${plan.paaForHeadings.join(" | ")}`);
  if (plan.paaForFaq.length) lines.push(`- Use these People Also Ask questions in the FAQ, as H3s, worded as searched: ${plan.paaForFaq.join(" | ")}`);
  return lines.join("\n");
}
