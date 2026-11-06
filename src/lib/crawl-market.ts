/**
 * Extra website checks for the full audit report: keyword consistency on the home page, templated
 * (near-duplicate) location/service pages, and off-page market data (authority, organic traffic,
 * organic keywords, competitors) from DataForSEO Labs and the Backlinks API.
 */
import { db } from "./db";
import { dfsPost } from "./dataforseo";

export type KeywordRow = { word: string; count: number; title: boolean; description: boolean; headings: boolean };
export type TemplatePage = { url: string; similarTo: string; pct: number };
export type Template = { checked: number; avgPct: number; pages: TemplatePage[] };
export type MarketCompetitor = { domain: string; traffic: number | null; keywords: number | null; intersections?: number | null; you?: boolean };
export type Market = {
  authority: number | null; backlinks: number | null; referringDomains: number | null;
  traffic: number | null; keywords: number | null; top3: number | null; top10: number | null;
  history: { date: string; backlinks: number; referringDomains: number }[];
  competitors: MarketCompetitor[];
  /** Top referring domains, for the backlink network graph. */
  network?: { domain: string; rank: number; backlinks: number }[];
  /** How often AI answers mention the brand and cite the site (DataForSEO LLM Mentions: Google AI Overview/AI Mode and ChatGPT). */
  aiVisibility?: { platforms: { key: string; label: string; mentions: number; cited: number }[]; mentions: number; cited: number; topSources: string[] } | null;
  notes: string[];
};

const PLATFORM: Record<string, string> = { google: "Google AI Overview / AI Mode", chat_gpt: "ChatGPT" };
type Agg = { aggregated_metrics?: Record<string, { key?: string; mentions?: number }[] | undefined> };

/** AI-answer visibility: brand-name mentions in AI answers, and how often the site is cited as a source. */
async function aiVisibility(brand: string, domain: string, location: string): Promise<Market["aiVisibility"]> {
  const base = { location_name: location, language_code: "en", internal_list_limit: 10 };
  const [byName, bySource] = await Promise.all([
    dfsPost<Agg>("ai_optimization/llm_mentions/target_metrics/live", [{ ...base, target: [{ keyword: brand, search_scope: ["answer"], match_type: "word_match" }] }], 120_000),
    dfsPost<Agg>("ai_optimization/llm_mentions/target_metrics/live", [{ ...base, target: [{ domain, search_scope: ["sources"], include_subdomains: true }] }], 120_000),
  ]);
  const per = (r: Agg[]) => new Map((r[0]?.aggregated_metrics?.platform ?? []).map((g) => [String(g.key ?? ""), Number(g.mentions ?? 0)]));
  const m = per(byName), c = per(bySource);
  const keys = [...new Set(["google", "chat_gpt", ...m.keys(), ...c.keys()])].filter(Boolean);
  const platforms = keys.map((k) => ({ key: k, label: PLATFORM[k] ?? k, mentions: m.get(k) ?? 0, cited: c.get(k) ?? 0 }));
  const topSources = (byName[0]?.aggregated_metrics?.sources_domain ?? []).map((g) => String(g.key ?? "")).filter(Boolean).slice(0, 8);
  return { platforms, mentions: platforms.reduce((a, p) => a + p.mentions, 0), cited: platforms.reduce((a, p) => a + p.cited, 0), topSources };
}

const STOP = new Set("about above after again against also among another because been before being below between both but came can come could does doing done down during each else even ever every from further have having here hers herself himself into itself just like made make many might more most much must myself never only other ours ourselves over same shall should some such than that their theirs them themselves then there these they this those through under until very what when where which while whom whose will with within without would your yours yourself yourselves home page click read learn call today contact menu skip content".split(" "));
const strip = (html: string) => html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();

/** The page's most used words, and whether each one also appears in the title, meta description and headings. */
export function keywordConsistency(html: string): KeywordRow[] {
  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").toLowerCase();
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ?? "").toLowerCase();
  const heads = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => strip(m[1])).join(" ").toLowerCase();
  const body = strip(html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html).toLowerCase();
  const counts = new Map<string, number>();
  const noise = new Set(["https", "http", "www", "html", "copyright", "rights", "reserved", "privacy", "policy"]);
  for (const w of body.replace(/\S+\.(com|net|org|co|io|uk|pk|ae)\S*/g, " ").match(/[a-z][a-z'-]{3,}/g) ?? []) if (!STOP.has(w) && !noise.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const has = (s: string, w: string) => new RegExp(`\\b${w.replace(/[^a-z'-]/g, "")}`, "i").test(s);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word, count]) => ({ word, count, title: has(title, word), description: has(desc, word), headings: has(heads, word) }));
}

const shingles = (text: string) => {
  const w = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const s = new Set<string>();
  for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(" "));
  return s;
};
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

/** Picks pages that look like a series (city/service pages with similar slugs) and measures how much text they share. */
export async function templateContent(urls: string[], home: string): Promise<Template | null> {
  const skip = /\/(blog|news|tag|category|author|page|wp-|feed|cart|checkout|my-account|privacy|terms|cookie)/i;
  const cands = urls.filter((u) => !skip.test(u) && u.replace(/\/$/, "") !== home.replace(/\/$/, ""));
  const tok = (u: string) => new Set((u.replace(/^https?:\/\/[^/]+/, "").toLowerCase().match(/[a-z]{3,}/g) ?? []));
  const toks = new Map(cands.map((u) => [u, tok(u)]));
  const score = (u: string) => cands.filter((o) => o !== u && [...toks.get(u)!].filter((t) => toks.get(o)!.has(t)).length >= 2).length;
  const picked = cands.map((u) => ({ u, s: score(u) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 14).map((x) => x.u);
  if (picked.length < 3) return null;
  const texts = await Promise.all(picked.map(async (u) => {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; RankflowAudit/1.0)" }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return null;
      const html = await r.text();
      const main = html.match(/<main[\s\S]*<\/main>/i)?.[0] ?? html.match(/<article[\s\S]*<\/article>/i)?.[0] ?? html;
      return { u, s: shingles(strip(main.replace(/<(header|footer|nav)[\s\S]*?<\/\1>/gi, " "))) };
    } catch {
      return null;
    }
  }));
  const ok = texts.filter((x): x is { u: string; s: Set<string> } => !!x && x.s.size > 30);
  if (ok.length < 3) return null;
  const pages = ok.map((a) => {
    let best = { u: "", v: 0 };
    for (const b of ok) if (b !== a) { const v = jaccard(a.s, b.s); if (v > best.v) best = { u: b.u, v }; }
    return { url: a.u, similarTo: best.u, pct: Math.round(best.v * 100) };
  }).sort((a, b) => b.pct - a.pct);
  return { checked: ok.length, avgPct: Math.round(pages.reduce((s, p) => s + p.pct, 0) / pages.length), pages };
}

type Overview = { metrics?: { organic?: { etv?: number; count?: number; pos_1?: number; pos_2_3?: number; pos_4_10?: number } } };
async function overview(target: string, location: string) {
  const r = await dfsPost<{ items?: Overview[] }>("dataforseo_labs/google/domain_rank_overview/live", [{ target, location_name: location, language_code: "en" }], 40_000);
  const o = r[0]?.items?.[0]?.metrics?.organic;
  return o ? { traffic: Math.round(o.etv ?? 0), keywords: o.count ?? 0, top3: (o.pos_1 ?? 0) + (o.pos_2_3 ?? 0), top10: (o.pos_1 ?? 0) + (o.pos_2_3 ?? 0) + (o.pos_4_10 ?? 0) } : null;
}

/** Authority, backlinks, organic traffic/keywords and the closest organic competitors. */
export async function marketData(clientId: string, target: string): Promise<Market> {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, targetCountry: true, competitors: true } });
  const location = client.targetCountry?.trim() || process.env.DATAFORSEO_DEFAULT_COUNTRY || "United States";
  const notes: string[] = [];
  const m: Market = { authority: null, backlinks: null, referringDomains: null, traffic: null, keywords: null, top3: null, top10: null, history: [], competitors: [], notes };

  const bl = await db.backlinkReport.findFirst({ where: { clientId }, orderBy: { createdAt: "desc" } });
  if (bl && Date.now() - bl.createdAt.getTime() < 45 * 864e5) {
    const s = bl.summary as { rank?: number; backlinks?: number; referringDomains?: number };
    Object.assign(m, { authority: s.rank ?? null, backlinks: s.backlinks ?? null, referringDomains: s.referringDomains ?? null });
    m.network = ((bl.domains as { domain: string; rank: number; backlinks: number }[] | null) ?? []).slice(0, 40).map((d) => ({ domain: d.domain, rank: d.rank, backlinks: d.backlinks }));
    m.history = ((bl.history as { date: string; backlinks: number; referringDomains: number }[] | null) ?? []).map((h) => ({ date: h.date, backlinks: h.backlinks, referringDomains: h.referringDomains }));
  } else {
    try {
      const r = await dfsPost<{ rank?: number; backlinks?: number; referring_domains?: number }>("backlinks/summary/live", [{ target, rank_scale: "one_hundred", include_subdomains: true }], 30_000);
      if (r[0]) Object.assign(m, { authority: r[0].rank ?? null, backlinks: r[0].backlinks ?? null, referringDomains: r[0].referring_domains ?? null });
    } catch (e) {
      notes.push(`Backlinks: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!m.network?.length) {
    try {
      const r = await dfsPost<{ items?: { domain: string; rank?: number; backlinks?: number }[] }>("backlinks/referring_domains/live", [{ target, include_subdomains: true, exclude_internal_backlinks: true, rank_scale: "one_hundred", backlinks_status_type: "live", limit: 40, order_by: ["rank,desc"] }], 30_000);
      m.network = (r[0]?.items ?? []).map((d) => ({ domain: d.domain, rank: d.rank ?? 0, backlinks: d.backlinks ?? 0 }));
    } catch { /* shown as "no data" */ }
  }
  m.aiVisibility = await aiVisibility(client.name, target, location).catch((e) => { notes.push(`AI visibility: ${e instanceof Error ? e.message : e}`); return null; });
  const own = await overview(target, location).catch((e) => { notes.push(`Organic traffic: ${e instanceof Error ? e.message : e}`); return null; });
  if (own) Object.assign(m, own);

  let comps: MarketCompetitor[] = [];
  const named = client.competitors.map((c) => c.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase()).filter(Boolean).slice(0, 5);
  if (named.length) {
    comps = await Promise.all(named.map(async (d) => ({ domain: d, ...((await overview(d, location).catch(() => null)) ?? { traffic: null, keywords: null }) })));
  } else {
    try {
      const r = await dfsPost<{ items?: { domain: string; intersections?: number; full_domain_metrics?: Overview["metrics"] }[] }>("dataforseo_labs/google/competitors_domain/live", [{ target, location_name: location, language_code: "en", limit: 8, exclude_top_domains: true }], 40_000);
      comps = (r[0]?.items ?? []).filter((c) => c.domain && !c.domain.includes(target)).slice(0, 5)
        .map((c) => ({ domain: c.domain, traffic: Math.round(c.full_domain_metrics?.organic?.etv ?? 0), keywords: c.full_domain_metrics?.organic?.count ?? 0, intersections: c.intersections ?? null }));
    } catch (e) {
      notes.push(`Competitors: ${e instanceof Error ? e.message : e}`);
    }
  }
  m.competitors = [{ domain: target, traffic: m.traffic, keywords: m.keywords, you: true }, ...comps];
  return m;
}

/** Letter grade like most audit tools show. */
export function grade(score: number) {
  return score >= 95 ? "A+" : score >= 90 ? "A" : score >= 85 ? "A-" : score >= 80 ? "B+" : score >= 75 ? "B" : score >= 70 ? "B-" : score >= 65 ? "C+" : score >= 60 ? "C" : score >= 55 ? "C-" : score >= 45 ? "D" : "F";
}
