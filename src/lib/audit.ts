/**
 * Site audit: PageSpeed Insights (mobile + desktop, home page) plus on-page checks on up to
 * MAX_PAGES pages taken from the sitemap. Runs inside one request, so everything has a time budget.
 */
import { parse, type HTMLElement } from "node-html-parser";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { logActivity } from "./activity";

const MAX_PAGES = 25;
const MAX_LINK_CHECKS = 60;
const PAGE_TIMEOUT = 10_000;
const UA = "Mozilla/5.0 (compatible; SEOControlCenterAudit/1.0)";

export type Severity = "error" | "warning" | "notice";
export type Issue = { code: string; severity: Severity; title: string; urls: string[]; count: number };
export type PsiField = { lcpMs: number | null; inpMs: number | null; cls: number | null; overall: string | null; origin: boolean };
export type PsiSummary = {
  performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null;
  lcpMs: number | null; cls: number | null; tbtMs: number | null; fcpMs: number | null;
  /** Real-user Chrome data (CrUX) for the page, or the whole site when the page has too little traffic. */
  field?: PsiField | null;
  /** Biggest Lighthouse savings, e.g. "Properly size images" (ms saved). */
  opportunities?: { title: string; savingsMs: number }[];
  error?: string;
};

const ISSUE_INFO: Record<string, { severity: Severity; title: string }> = {
  site_unreachable: { severity: "error", title: "Home page did not load" },
  no_https: { severity: "error", title: "Site is not served over HTTPS" },
  no_sitemap: { severity: "warning", title: "No XML sitemap found" },
  no_robots: { severity: "notice", title: "No robots.txt found" },
  robots_blocks_all: { severity: "error", title: "robots.txt blocks all crawlers" },
  page_error: { severity: "error", title: "Page returns an error (4xx/5xx)" },
  noindex: { severity: "error", title: "Page is set to noindex" },
  broken_link: { severity: "error", title: "Broken internal link" },
  title_missing: { severity: "error", title: "Missing title tag" },
  title_long: { severity: "warning", title: "Title longer than 60 characters" },
  title_short: { severity: "notice", title: "Title shorter than 30 characters" },
  title_duplicate: { severity: "warning", title: "Same title on several pages" },
  meta_missing: { severity: "warning", title: "Missing meta description" },
  meta_long: { severity: "notice", title: "Meta description longer than 160 characters" },
  meta_duplicate: { severity: "notice", title: "Same meta description on several pages" },
  h1_missing: { severity: "warning", title: "No H1 heading" },
  h1_multiple: { severity: "notice", title: "More than one H1 heading" },
  canonical_missing: { severity: "notice", title: "No canonical tag" },
  img_alt_missing: { severity: "notice", title: "Images without alt text" },
  thin_content: { severity: "notice", title: "Thin content (under 300 words)" },
  slow_mobile: { severity: "warning", title: "Mobile performance score under 50" },
  poor_lcp: { severity: "warning", title: "Largest Contentful Paint over 4s (mobile)" },
  poor_cls: { severity: "warning", title: "Layout shift (CLS) over 0.25 (mobile)" },
};

const WEIGHT: Record<Severity, number> = { error: 12, warning: 5, notice: 1.5 };

async function get(url: string, timeout = PAGE_TIMEOUT, method: "GET" | "HEAD" = "GET") {
  return fetch(url, { method, redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(timeout) });
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const n = i++;
      out[n] = await fn(items[n]);
    }
  }));
  return out;
}

// ---------- PageSpeed ----------

export async function pageSpeed(url: string, strategy: "mobile" | "desktop"): Promise<PsiSummary> {
  const q = new URLSearchParams({ url, strategy });
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) q.append("category", c);
  if (process.env.PAGESPEED_API_KEY) q.set("key", process.env.PAGESPEED_API_KEY);
  const empty: PsiSummary = { performance: null, seo: null, accessibility: null, bestPractices: null, lcpMs: null, cls: null, tbtMs: null, fcpMs: null };
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(50_000) });
    if (!res.ok) {
      const msg = res.status === 429 ? "PageSpeed daily limit reached. Add a PAGESPEED_API_KEY in Vercel." : `PageSpeed responded ${res.status}`;
      return { ...empty, error: msg };
    }
    const j = await res.json();
    const cat = j.lighthouseResult?.categories ?? {};
    const aud = j.lighthouseResult?.audits ?? {};
    const pct = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) : null);
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    return {
      performance: pct(cat.performance?.score),
      seo: pct(cat.seo?.score),
      accessibility: pct(cat.accessibility?.score),
      bestPractices: pct(cat["best-practices"]?.score),
      lcpMs: num(aud["largest-contentful-paint"]?.numericValue),
      cls: num(aud["cumulative-layout-shift"]?.numericValue),
      tbtMs: num(aud["total-blocking-time"]?.numericValue),
      fcpMs: num(aud["first-contentful-paint"]?.numericValue),
      field: (() => {
        const le = j.loadingExperience?.metrics ? j.loadingExperience : j.originLoadingExperience?.metrics ? j.originLoadingExperience : null;
        if (!le) return null;
        const m = le.metrics;
        return {
          lcpMs: num(m.LARGEST_CONTENTFUL_PAINT_MS?.percentile),
          inpMs: num(m.INTERACTION_TO_NEXT_PAINT?.percentile),
          cls: typeof m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile === "number" ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
          overall: typeof le.overall_category === "string" ? le.overall_category : null,
          origin: le !== j.loadingExperience,
        };
      })(),
      opportunities: Object.values(aud as Record<string, { title?: string; details?: { type?: string; overallSavingsMs?: number } }>)
        .filter((a) => a.details?.type === "opportunity" && (a.details.overallSavingsMs ?? 0) >= 100)
        .map((a) => ({ title: String(a.title ?? ""), savingsMs: Math.round(a.details!.overallSavingsMs!) }))
        .sort((a, b) => b.savingsMs - a.savingsMs)
        .slice(0, 6),
    };
  } catch (e) {
    return { ...empty, error: e instanceof Error && e.name === "TimeoutError" ? "PageSpeed took too long" : String(e) };
  }
}

// ---------- Crawl ----------

async function sitemapUrls(origin: string, robotsText: string): Promise<string[] | null> {
  const fromRobots = [...robotsText.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const candidates = [...fromRobots, `${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`, `${origin}/wp-sitemap.xml`];
  for (const sm of [...new Set(candidates)]) {
    try {
      const res = await get(sm, 8_000);
      if (!res.ok) continue;
      const xml = await res.text();
      if (!/<(urlset|sitemapindex)/i.test(xml)) continue;
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
      if (/<sitemapindex/i.test(xml)) {
        // Prefer page and post sitemaps; read up to three child sitemaps.
        const children = locs.sort((a, b) => Number(/post|page/i.test(b)) - Number(/post|page/i.test(a))).slice(0, 3);
        const nested = await Promise.all(children.map(async (c) => {
          try {
            const r = await get(c, 8_000);
            const x = r.ok ? await r.text() : "";
            return [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
          } catch {
            return [];
          }
        }));
        return nested.flat().filter((u) => !/\.(xml|jpg|jpeg|png|webp|gif|pdf)(\?|$)/i.test(u));
      }
      return locs.filter((u) => !/\.(xml|jpg|jpeg|png|webp|gif|pdf)(\?|$)/i.test(u));
    } catch {
      /* try the next one */
    }
  }
  return null;
}

type PageResult = { url: string; status: number; title: string; meta: string; h1: number; noindex: boolean; canonical: boolean; imgNoAlt: number; words: number; links: string[] };

function analyse(url: string, status: number, html: string, origin: string): PageResult {
  const root: HTMLElement = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  const robots = root.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";
  const body = root.querySelector("body");
  const text = (body?.textContent ?? "").replace(/\s+/g, " ").trim();
  const links = root
    .querySelectorAll("a[href]")
    .map((a) => {
      try {
        const u = new URL(a.getAttribute("href")!, url);
        u.hash = "";
        return u.toString();
      } catch {
        return "";
      }
    })
    .filter((u) => u.startsWith(origin) && !/\.(jpg|jpeg|png|webp|gif|pdf|zip)(\?|$)/i.test(u) && !/\/wp-(admin|login)/.test(u));
  return {
    url,
    status,
    title: (root.querySelector("title")?.textContent ?? "").trim(),
    meta: (root.querySelector('meta[name="description"]')?.getAttribute("content") ?? "").trim(),
    h1: root.querySelectorAll("h1").length,
    noindex: /noindex/i.test(robots),
    canonical: Boolean(root.querySelector('link[rel="canonical"]')),
    imgNoAlt: root.querySelectorAll("img").filter((i) => !i.hasAttribute("alt")).length,
    words: text ? text.split(" ").length : 0,
    links: [...new Set(links)],
  };
}

/** True when the "User-agent: *" group has "Disallow: /" and no Allow rule. */
function blocksEveryone(robots: string) {
  let inStar = false;
  let lastWasAgent = false;
  let disallowAll = false;
  let allows = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [key, value] = [m[1].toLowerCase(), m[2].trim()];
    if (key === "user-agent") {
      inStar = lastWasAgent ? inStar || value === "*" : value === "*";
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!inStar) continue;
    if (key === "disallow" && value === "/") disallowAll = true;
    if (key === "allow" && value) allows = true;
  }
  return disallowAll && !allows;
}

// ---------- Run ----------

export async function runAudit(clientId: string, actorId?: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
  const audit = await db.siteAudit.create({ data: { clientId, startedById: actorId } });
  try {
    const result = await auditSite(client.siteUrl);
    await db.siteAudit.update({
      where: { id: audit.id },
      data: {
        status: "DONE",
        score: result.score,
        pagesChecked: result.pagesChecked,
        psiMobile: result.psiMobile as unknown as Prisma.InputJsonValue,
        psiDesktop: result.psiDesktop as unknown as Prisma.InputJsonValue,
        issues: result.issues as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    await logActivity({ actorId, clientId, action: "audit.done", entity: "client", entityId: clientId, after: { score: result.score, pages: result.pagesChecked } });
  } catch (e) {
    await db.siteAudit.update({ where: { id: audit.id }, data: { status: "FAILED", error: e instanceof Error ? e.message : String(e), finishedAt: new Date() } });
  }
  return audit.id;
}

export async function auditSite(siteUrl: string) {
  const home = siteUrl.replace(/\/+$/, "") + "/";
  const found = new Map<string, string[]>(); // issue code -> urls
  const flag = (code: string, url = home) => {
    const list = found.get(code) ?? [];
    if (!list.includes(url)) list.push(url);
    found.set(code, list);
  };

  // PageSpeed runs in parallel with the crawl.
  const psiPromise = Promise.all([pageSpeed(home, "mobile"), pageSpeed(home, "desktop")]);

  let origin = new URL(home).origin;
  let homeRes: Response | null = null;
  try {
    homeRes = await get(home);
    origin = new URL(homeRes.url).origin;
  } catch {
    flag("site_unreachable");
  }
  if (homeRes && !homeRes.ok) flag("site_unreachable");
  if (!origin.startsWith("https://")) flag("no_https");

  let robotsText = "";
  try {
    const r = await get(`${origin}/robots.txt`, 6_000);
    if (r.ok) robotsText = await r.text();
    else flag("no_robots");
  } catch {
    flag("no_robots");
  }
  if (blocksEveryone(robotsText)) flag("robots_blocks_all", `${origin}/robots.txt`);

  const fromSitemap = homeRes?.ok ? await sitemapUrls(origin, robotsText) : null;
  if (homeRes?.ok && !fromSitemap) flag("no_sitemap");

  // Pages: home first, then sitemap pages (pages before posts), same host only.
  const homeHtml = homeRes?.ok ? await homeRes.text() : "";
  const pages: PageResult[] = [];
  if (homeHtml) pages.push(analyse(homeRes!.url, homeRes!.status, homeHtml, origin));
  const queue = [...new Set((fromSitemap ?? pages[0]?.links ?? []).filter((u) => u.startsWith(origin) && u !== homeRes?.url && u !== home))].slice(0, MAX_PAGES - 1);
  const crawled = await pool(queue, 5, async (url) => {
    try {
      const r = await get(url);
      const type = r.headers.get("content-type") ?? "";
      if (!type.includes("html")) return { url, status: r.status, html: "" };
      return { url, status: r.status, html: r.ok ? await r.text() : "" };
    } catch {
      return { url, status: 0, html: "" };
    }
  });
  for (const c of crawled) {
    if (c.status === 0 || c.status >= 400) flag("page_error", c.url);
    else if (c.html) pages.push(analyse(c.url, c.status, c.html, origin));
  }

  // Per-page checks
  const titles = new Map<string, string[]>();
  const metas = new Map<string, string[]>();
  for (const p of pages) {
    if (p.noindex) flag("noindex", p.url);
    if (!p.title) flag("title_missing", p.url);
    else {
      if (p.title.length > 60) flag("title_long", p.url);
      if (p.title.length < 30) flag("title_short", p.url);
      titles.set(p.title, [...(titles.get(p.title) ?? []), p.url]);
    }
    if (!p.meta) flag("meta_missing", p.url);
    else {
      if (p.meta.length > 160) flag("meta_long", p.url);
      metas.set(p.meta, [...(metas.get(p.meta) ?? []), p.url]);
    }
    if (p.h1 === 0) flag("h1_missing", p.url);
    if (p.h1 > 1) flag("h1_multiple", p.url);
    if (!p.canonical) flag("canonical_missing", p.url);
    if (p.imgNoAlt > 0) flag("img_alt_missing", p.url);
    if (p.words < 300) flag("thin_content", p.url);
  }
  for (const urls of titles.values()) if (urls.length > 1) urls.forEach((u) => flag("title_duplicate", u));
  for (const urls of metas.values()) if (urls.length > 1) urls.forEach((u) => flag("meta_duplicate", u));

  // Broken internal links (HEAD, falling back to GET when HEAD isn't allowed)
  const checked = new Set([...pages.map((p) => p.url), ...crawled.map((c) => c.url)]);
  const linkSources = new Map<string, string>();
  for (const p of pages) for (const l of p.links) if (!checked.has(l) && !linkSources.has(l)) linkSources.set(l, p.url);
  await pool([...linkSources.keys()].slice(0, MAX_LINK_CHECKS), 8, async (link) => {
    try {
      let r = await get(link, 6_000, "HEAD");
      if (r.status === 405 || r.status === 403) r = await get(link, 6_000);
      if (r.status === 404 || r.status === 410 || r.status >= 500) flag("broken_link", `${link} (on ${linkSources.get(link)})`);
    } catch {
      /* timeouts are not counted as broken */
    }
  });

  const [psiMobile, psiDesktop] = await psiPromise;
  if (psiMobile.performance != null && psiMobile.performance < 50) flag("slow_mobile");
  if (psiMobile.lcpMs != null && psiMobile.lcpMs > 4000) flag("poor_lcp");
  if (psiMobile.cls != null && psiMobile.cls > 0.25) flag("poor_cls");

  const pagesChecked = Math.max(pages.length, 1);
  const issues: Issue[] = [...found]
    .map(([code, urls]) => ({ code, ...ISSUE_INFO[code], urls: urls.slice(0, 50), count: urls.length }))
    .sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity] || b.count - a.count);

  // Health score: each issue type costs its weight, scaled by the share of pages it affects (min 25%).
  const penalty = issues.reduce((sum, i) => sum + WEIGHT[i.severity] * Math.max(0.25, Math.min(1, i.count / pagesChecked)), 0);
  const score = found.has("site_unreachable") ? 0 : Math.max(0, Math.round(100 - penalty));
  return { score, pagesChecked: pages.length, psiMobile, psiDesktop, issues };
}
