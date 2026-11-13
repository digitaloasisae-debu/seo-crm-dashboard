/**
 * "Audit any website": a sales-meeting audit for a site that isn't a client yet.
 * No Google Analytics, Search Console or Business Profile access, so it combines:
 * - our own crawl and on-page checks, plus Google PageSpeed with page screenshots (auditSite)
 * - SSL certificate (TLS handshake), domain age (RDAP) and first archive.org snapshot
 * - DataForSEO: organic keywords and traffic, top keywords, competitors, backlinks, and whether a Google Business listing shows for the business name
 * Every finding is a measured fact plus our standard "how we can help" line.
 */
import tls from "node:tls";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { auditSite, type Issue, type PsiSummary, type Shot } from "./audit";
import { AUDIT_HELP, type Help } from "./audit-help";
import { dataforseoConfigured, dfsPost } from "./dataforseo";
import { geminiConfigured, geminiJson } from "./gemini";

export type Finding = { code: string; severity: Issue["severity"]; title: string; evidence: string; impact: string; help: string; service: Help["service"]; urls: string[] };
export type ProspectResult = {
  url: string;
  score: number;
  pagesChecked: number;
  psiMobile: PsiSummary;
  psiDesktop: PsiSummary;
  shots: Shot[];
  issues: Issue[];
  findings: Finding[];
  ssl: { valid: boolean; issuer: string | null; expires: string | null; daysLeft: number | null; error?: string } | null;
  domainAge: { registered: string | null; firstArchived: string | null; years: number | null };
  organic: { keywords: number | null; traffic: number | null; top3: number | null; top10: number | null } | null;
  topKeywords: { keyword: string; position: number | null; volume: number | null; url: string | null }[];
  competitors: { domain: string; keywords: number | null; traffic: number | null; shared: number | null }[];
  backlinks: { authority: number | null; backlinks: number | null; referringDomains: number | null } | null;
  google: { query: string; listing: { title: string; rating: number | null; reviews: number | null; source: string } | null; ownRank: number | null } | null;
  keywordCheck: { keyword: string; position: number | null; top: { position: number; domain: string; title: string }[] } | null;
  summary: string | null;
  notes: string[];
};

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
export const normalizeUrl = (raw: string) => {
  const t = raw.trim();
  if (!t) return "";
  try { const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); return `${u.protocol}//${u.hostname}/`; } catch { return ""; }
};

function sslInfo(hostname: string): Promise<ProspectResult["ssl"]> {
  return new Promise((resolve) => {
    const sock = tls.connect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: false, timeout: 8000 }, () => {
      const c = sock.getPeerCertificate();
      const expires = c?.valid_to ? new Date(c.valid_to) : null;
      resolve({ valid: sock.authorized, issuer: (c?.issuer?.O as string | undefined) ?? (c?.issuer?.CN as string | undefined) ?? null, expires: expires?.toISOString() ?? null, daysLeft: expires ? Math.floor((expires.getTime() - Date.now()) / 864e5) : null, ...(sock.authorized ? {} : { error: String(sock.authorizationError ?? "Certificate not trusted") }) });
      sock.end();
    });
    sock.on("error", (e) => resolve({ valid: false, issuer: null, expires: null, daysLeft: null, error: e.message }));
    sock.on("timeout", () => { sock.destroy(); resolve(null); });
  });
}

async function domainAge(domain: string): Promise<ProspectResult["domainAge"]> {
  const [registered, firstArchived] = await Promise.all([
    fetch(`https://rdap.org/domain/${domain}`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/rdap+json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { events?: { eventAction: string; eventDate: string }[] } | null) => j?.events?.find((e) => e.eventAction === "registration")?.eventDate ?? null)
      .catch(() => null),
    fetch(`https://archive.org/wayback/available?url=${domain}&timestamp=19960101`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { archived_snapshots?: { closest?: { timestamp?: string } } } | null) => {
        const t = j?.archived_snapshots?.closest?.timestamp;
        return t ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : null;
      })
      .catch(() => null),
  ]);
  const first = [registered, firstArchived].filter(Boolean).map((d) => new Date(d!).getTime()).sort()[0];
  return { registered, firstArchived, years: first ? Math.floor((Date.now() - first) / (365.25 * 864e5)) : null };
}

type Overview = { metrics?: { organic?: { etv?: number; count?: number; pos_1?: number; pos_2_3?: number; pos_4_10?: number } } };

async function seoData(domain: string, location: string, notes: string[]) {
  const out: Pick<ProspectResult, "organic" | "topKeywords" | "competitors" | "backlinks"> = { organic: null, topKeywords: [], competitors: [], backlinks: null };
  if (!dataforseoConfigured()) { notes.push("DataForSEO isn't set up, so search visibility and backlinks are missing."); return out; }
  await Promise.all([
    dfsPost<{ items?: Overview[] }>("dataforseo_labs/google/domain_rank_overview/live", [{ target: domain, location_name: location, language_code: "en" }], 40_000)
      .then((r) => { const o = r[0]?.items?.[0]?.metrics?.organic; out.organic = { keywords: o?.count ?? 0, traffic: Math.round(o?.etv ?? 0), top3: (o?.pos_1 ?? 0) + (o?.pos_2_3 ?? 0), top10: (o?.pos_1 ?? 0) + (o?.pos_2_3 ?? 0) + (o?.pos_4_10 ?? 0) }; })
      .catch((e) => notes.push(`Organic traffic: ${e instanceof Error ? e.message : e}`)),
    dfsPost<{ items?: { keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number } }; ranked_serp_element?: { serp_item?: { rank_group?: number; url?: string } } }[] }>("dataforseo_labs/google/ranked_keywords/live", [{ target: domain, location_name: location, language_code: "en", limit: 10, order_by: ["keyword_data.keyword_info.search_volume,desc"] }], 40_000)
      .then((r) => { out.topKeywords = (r[0]?.items ?? []).map((i) => ({ keyword: i.keyword_data?.keyword ?? "", volume: i.keyword_data?.keyword_info?.search_volume ?? null, position: i.ranked_serp_element?.serp_item?.rank_group ?? null, url: i.ranked_serp_element?.serp_item?.url ?? null })).filter((k) => k.keyword); })
      .catch((e) => notes.push(`Top keywords: ${e instanceof Error ? e.message : e}`)),
    dfsPost<{ items?: { domain: string; intersections?: number; full_domain_metrics?: Overview["metrics"] }[] }>("dataforseo_labs/google/competitors_domain/live", [{ target: domain, location_name: location, language_code: "en", limit: 8, exclude_top_domains: true }], 40_000)
      .then((r) => { out.competitors = (r[0]?.items ?? []).filter((c) => c.domain && !c.domain.includes(domain)).slice(0, 5).map((c) => ({ domain: c.domain, keywords: c.full_domain_metrics?.organic?.count ?? null, traffic: Math.round(c.full_domain_metrics?.organic?.etv ?? 0), shared: c.intersections ?? null })); })
      .catch((e) => notes.push(`Competitors: ${e instanceof Error ? e.message : e}`)),
    dfsPost<{ rank?: number; backlinks?: number; referring_domains?: number }>("backlinks/summary/live", [{ target: domain, rank_scale: "one_hundred", include_subdomains: true }], 30_000)
      .then((r) => { if (r[0]) out.backlinks = { authority: r[0].rank ?? null, backlinks: r[0].backlinks ?? null, referringDomains: r[0].referring_domains ?? null }; })
      .catch((e) => notes.push(`Backlinks: ${e instanceof Error ? e.message : e}`)),
  ]);
  return out;
}

type SerpItem = { type: string; rank_group?: number; domain?: string; url?: string; title?: string; rating?: { value?: number; votes_count?: number } | null; items?: { type?: string; domain?: string; title?: string; rating?: { value?: number; votes_count?: number } | null }[] };

async function serp(keyword: string, location: string) {
  const r = await dfsPost<{ items?: SerpItem[] }>("serp/google/organic/live/advanced", [{ keyword, location_name: location, language_code: "en", depth: 20 }], 50_000);
  return r[0]?.items ?? [];
}

/** Does a Google Business listing (local pack or knowledge panel) show when someone searches the business name? */
async function googlePresence(name: string, domain: string, city: string | null, location: string): Promise<ProspectResult["google"]> {
  const query = city && !name.toLowerCase().includes(city.toLowerCase()) ? `${name} ${city}` : name;
  const items = await serp(query, location);
  const own = items.find((i) => i.type === "organic" && i.domain && host(`https://${i.domain}`) === domain);
  const lower = name.toLowerCase();
  let listing: NonNullable<ProspectResult["google"]>["listing"] = null;
  const kg = items.find((i) => i.type === "knowledge_graph");
  if (kg && (kg.title ?? "").toLowerCase().includes(lower.split(" ")[0])) listing = { title: kg.title ?? name, rating: kg.rating?.value ?? null, reviews: kg.rating?.votes_count ?? null, source: "Knowledge panel" };
  if (!listing) {
    for (const i of items) {
      const cands = i.type === "local_pack" ? [i] : i.type === "maps" || i.type === "local_pack_group" ? i.items ?? [] : [];
      const hit = cands.find((c) => (c.domain && host(`https://${c.domain}`) === domain) || (c.title ?? "").toLowerCase().includes(lower));
      if (hit) { listing = { title: hit.title ?? name, rating: hit.rating?.value ?? null, reviews: hit.rating?.votes_count ?? null, source: "Map results" }; break; }
    }
  }
  return { query, listing, ownRank: own?.rank_group ?? null };
}

async function keywordCheck(keyword: string, domain: string, location: string): Promise<ProspectResult["keywordCheck"]> {
  const items = (await serp(keyword, location)).filter((i) => i.type === "organic" && i.domain);
  const own = items.find((i) => host(`https://${i.domain}`) === domain);
  return { keyword, position: own?.rank_group ?? null, top: items.slice(0, 5).map((i) => ({ position: i.rank_group ?? 0, domain: i.domain!.replace(/^www\./, ""), title: i.title ?? "" })) };
}

const fmt = (n: number | null | undefined) => (n == null ? "?" : n.toLocaleString("en-US"));

/** Turn measured data into report findings: the fact, what it costs the business, and how we help. */
function buildFindings(r: Omit<ProspectResult, "findings" | "summary">): Finding[] {
  const out: Finding[] = r.issues.filter((i) => AUDIT_HELP[i.code]).map((i) => ({
    code: i.code, severity: i.severity, title: i.title, urls: i.urls.slice(0, 10),
    evidence: i.count > 1 || i.urls.length > 1 ? `${i.count} of ${r.pagesChecked} pages checked` : i.urls[0] ?? "",
    ...AUDIT_HELP[i.code],
  }));
  const add = (f: Omit<Finding, "urls"> & { urls?: string[] }) => out.push({ urls: [], ...f });
  if (r.ssl && (!r.ssl.valid || (r.ssl.daysLeft != null && r.ssl.daysLeft < 21))) add({ code: "ssl", severity: r.ssl.valid ? "warning" : "error", title: r.ssl.valid ? `SSL certificate expires in ${r.ssl.daysLeft} days` : "SSL certificate is not valid", evidence: r.ssl.error ?? `Expires ${r.ssl.expires?.slice(0, 10)}`, impact: "When the certificate fails, browsers block the site with a security warning.", help: "We fix the certificate and set it to renew automatically.", service: "Technical SEO" });
  if (r.organic && (r.organic.keywords ?? 0) < 50) add({ code: "low_visibility", severity: "warning", title: `Ranks on Google for only ${fmt(r.organic.keywords)} keywords`, evidence: `${fmt(r.organic.top10)} in the top 10, about ${fmt(r.organic.traffic)} visits a month from Google (DataForSEO estimate)`, impact: "Most people searching for these services never see the site.", help: "We research the keywords the business's customers use, then build service pages and blogs that target them.", service: "Content" });
  else if (r.organic && (r.organic.top10 ?? 0) < Math.max(5, (r.organic.keywords ?? 0) * 0.1)) add({ code: "low_top10", severity: "notice", title: `Only ${fmt(r.organic.top10)} of ${fmt(r.organic.keywords)} keywords are on page one`, evidence: `About ${fmt(r.organic.traffic)} visits a month from Google (DataForSEO estimate)`, impact: "Keywords on page two or lower get almost no clicks.", help: "We improve the pages that sit just outside page one so they move up.", service: "On-page SEO" });
  const leader = r.competitors.find((c) => (c.traffic ?? 0) > Math.max(1, (r.organic?.traffic ?? 0) * 2));
  if (leader) add({ code: "competitor_gap", severity: "notice", title: `${leader.domain} gets about ${fmt(leader.traffic)} visits a month from Google`, evidence: `This site: about ${fmt(r.organic?.traffic ?? 0)}. They share ${fmt(leader.shared)} keywords.`, impact: "A competitor is taking the searches this business could win.", help: "We study what that competitor ranks for and build better pages for those searches.", service: "Content" });
  if (r.backlinks && (r.backlinks.referringDomains ?? 0) < 20) add({ code: "few_backlinks", severity: "warning", title: `Only ${fmt(r.backlinks.referringDomains)} websites link to this site`, evidence: `${fmt(r.backlinks.backlinks)} backlinks, authority ${fmt(r.backlinks.authority)}/100 (DataForSEO)`, impact: "Links from other sites are one of Google's main trust signals. With few of them, ranking is harder.", help: "We earn links from local directories, partners and industry sites.", service: "Technical SEO" });
  if (r.google && !r.google.listing) add({ code: "no_gbp", severity: "warning", title: "No Google Business listing shows for the business name", evidence: `Searched "${r.google.query}"`, impact: "The map results and business panel are where most local customers call from.", help: "We set up or claim the Google Business Profile, then optimise it and post on it weekly.", service: "Local SEO" });
  else if (r.google?.listing && r.google.listing.reviews != null && r.google.listing.reviews < 30) add({ code: "few_reviews", severity: "notice", title: `${r.google.listing.reviews} Google reviews${r.google.listing.rating ? `, ${r.google.listing.rating}★` : ""}`, evidence: `${r.google.listing.source} for "${r.google.query}"`, impact: "Review count and rating affect both map rankings and whether people call.", help: "We set up a simple review request flow and reply to every review.", service: "Local SEO" });
  if (r.google && r.google.ownRank == null) add({ code: "brand_not_ranking", severity: "error", title: "The website isn't in the top 20 when you search the business name", evidence: `Searched "${r.google.query}"`, impact: "Even people looking for this business by name can't find its website.", help: "We fix the brand signals: titles, schema, Google Business link and citations.", service: "Local SEO" });
  if (r.keywordCheck && (r.keywordCheck.position == null || r.keywordCheck.position > 10)) add({ code: "keyword_not_top10", severity: "warning", title: r.keywordCheck.position ? `#${r.keywordCheck.position} on Google for "${r.keywordCheck.keyword}"` : `Not in the top 20 on Google for "${r.keywordCheck.keyword}"`, evidence: `Top result: ${r.keywordCheck.top[0]?.domain ?? "?"}`, impact: "Page one gets over 90% of the clicks for this search.", help: "We build a page aimed at this search, using what the top results cover.", service: "On-page SEO" });
  const rank = { error: 0, warning: 1, notice: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export async function runProspect(id: string) {
  const p = await db.prospectAudit.findUniqueOrThrow({ where: { id } });
  const notes: string[] = [];
  try {
    const domain = p.domain;
    const location = p.country?.trim() || process.env.DATAFORSEO_DEFAULT_COUNTRY || "United States";
    const name = p.name?.trim() || domain.split(".")[0].replace(/[-_]+/g, " ");
    const [site, ssl, age, seo, google, kw] = await Promise.all([
      auditSite(p.url, { extraShots: 3 }),
      sslInfo(domain).catch(() => null),
      domainAge(domain),
      seoData(domain, location, notes),
      dataforseoConfigured() ? googlePresence(name, domain, p.city, location).catch((e) => { notes.push(`Google search: ${e instanceof Error ? e.message : e}`); return null; }) : Promise.resolve(null),
      dataforseoConfigured() && p.keyword?.trim() ? keywordCheck([p.keyword.trim(), p.city?.trim()].filter(Boolean).join(" "), domain, location).catch(() => null) : Promise.resolve(null),
    ]);
    const base = { url: p.url, score: site.score, pagesChecked: site.pagesChecked, psiMobile: site.psiMobile, psiDesktop: site.psiDesktop, shots: site.shots, issues: site.issues, ssl, domainAge: age, ...seo, google, keywordCheck: kw, notes };
    const findings = buildFindings(base);
    let summary: string | null = null;
    if (geminiConfigured() && findings.length) {
      summary = await geminiJson<{ summary: string }>(
        `Website: ${p.url}${p.name ? ` (${p.name})` : ""}\nFindings (measured):\n${findings.slice(0, 12).map((f) => `- ${f.title} (${f.evidence})`).join("\n")}`,
        { system: `Write a 3–4 sentence summary for a business owner of the biggest problems found on their website, in plain English, most important first. Use only the findings given, with their numbers. Don't guess causes, and don't add facts. End with one sentence on what fixing them would involve. Return JSON {"summary":"..."}`, timeoutMs: 30_000 },
      ).then((o) => o.summary?.trim() || null).catch(() => null);
    }
    const result: ProspectResult = { ...base, findings, summary };
    await db.prospectAudit.update({ where: { id }, data: { status: "DONE", score: site.score, result: result as unknown as Prisma.InputJsonValue, finishedAt: new Date() } });
  } catch (e) {
    await db.prospectAudit.update({ where: { id }, data: { status: "FAILED", error: e instanceof Error ? e.message : String(e), finishedAt: new Date() } });
  }
}
