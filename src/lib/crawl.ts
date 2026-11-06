/**
 * Full technical audit with the DataForSEO On-Page API: it crawls the whole site (up to maxPages)
 * and runs 60+ checks per page. The crawl runs at DataForSEO; we start it, then poll until it's finished.
 */
import { createHmac } from "crypto";
import type { Prisma, SiteCrawl } from "@prisma/client";
import { db } from "./db";
import { dfsPost, dfsTask } from "./dataforseo";
import { logActivity } from "./activity";

export type Sev = "error" | "warning" | "notice";
export type CrawlIssue = {
  code: string; severity: Sev; title: string; hint: string; count: number; urls: string[];
  /** Broken links: which page links to which broken URL. */
  links?: { from: string; to: string; status?: number }[];
  /** Duplicate titles/descriptions: the repeated text and the pages that share it. */
  groups?: { value: string; urls: string[] }[];
};

/** Checks where true is GOOD (the problem is the pages where it's false). */
const POSITIVE = new Set(["is_https", "has_html_doctype", "canonical", "meta_charset_consistency", "seo_friendly_url", "seo_friendly_url_characters_check", "seo_friendly_url_dynamic_check", "seo_friendly_url_keywords_check", "seo_friendly_url_relative_length_check", "has_micromarkup"]);
/** Facts, not problems. */
const IGNORE = new Set(["is_www", "has_frame", "has_flash", "is_redirect", "frame", "flash", "has_micromarkup", "seo_friendly_url_keywords_check", "no_image_title", "irrelevant_meta_keywords", "high_content_rate", "high_character_count",
  // Noise: text-to-code ratio isn't a ranking factor, and the spell checker flags names, places and non-English words.
  "low_content_rate", "has_misspelling",
]);

const CATALOG: Record<string, [Sev, string, string]> = {
  is_4xx_code: ["error", "Pages returning 4xx errors", "Fix or redirect these URLs, and remove internal links to them."],
  is_5xx_code: ["error", "Pages returning 5xx server errors", "Server or plugin problem: check hosting logs."],
  is_broken: ["error", "Broken pages", "These pages don't load. Fix or 301-redirect them."],
  is_http: ["error", "Pages still on HTTP", "Redirect all HTTP URLs to HTTPS."],
  is_https: ["error", "Pages not on HTTPS", "Serve every page over HTTPS."],
  https_to_http_links: ["warning", "HTTPS pages linking to HTTP", "Update the links to https://."],
  no_title: ["error", "Missing title tag", "Add a unique title (under 60 characters) with the page's keyword."],
  duplicate_title_tag: ["warning", "More than one title tag on the page", "Keep a single <title>; often a theme + SEO plugin conflict."],
  title_too_long: ["warning", "Title too long", "Keep titles under 60 characters so Google doesn't cut them."],
  title_too_short: ["notice", "Title too short", "Use more of the ~60 characters: keyword + benefit + brand."],
  irrelevant_title: ["notice", "Title doesn't match the page content", "Rewrite the title around what the page is actually about."],
  no_description: ["warning", "Missing meta description", "Write 150–160 characters with the keyword and a reason to click."],
  irrelevant_description: ["notice", "Meta description doesn't match the content", "Rewrite it to summarise the page."],
  duplicate_meta_tags: ["warning", "Duplicate meta tags", "Remove repeated meta tags (often two SEO plugins)."],
  no_h1_tag: ["warning", "No H1 heading", "Give every page one H1 with its main keyword."],
  no_image_alt: ["notice", "Images without alt text", "Add descriptive alt text; it helps image search and accessibility."],
  no_favicon: ["notice", "No favicon", "Add a site icon in WordPress (Appearance → Customize → Site Identity)."],
  no_doctype: ["notice", "No <!DOCTYPE>", "Theme issue: add <!DOCTYPE html> at the top."],
  has_html_doctype: ["notice", "No HTML5 doctype", "Theme issue: use <!DOCTYPE html>."],
  no_encoding_meta_tag: ["notice", "No character encoding tag", "Add <meta charset=\"utf-8\">."],
  meta_charset_consistency: ["notice", "Character encoding mismatch", "Make the page and server encoding match (UTF-8)."],
  no_content_encoding: ["warning", "No compression (gzip/brotli)", "Turn on compression in hosting or a caching plugin."],
  high_loading_time: ["warning", "Slow pages (over 3 seconds)", "Use caching, a CDN and compressed images."],
  high_waiting_time: ["warning", "Slow server response (TTFB)", "Better hosting or page caching."],
  has_render_blocking_resources: ["notice", "Render-blocking CSS/JS", "Defer or inline critical CSS/JS (e.g. with a speed plugin)."],
  large_page_size: ["notice", "Large page size", "Compress images and remove unused scripts."],
  size_greater_than_3mb: ["warning", "Pages over 3 MB", "Compress or lazy-load images and video."],
  small_page_size: ["notice", "Very small pages", "Check these aren't empty or broken."],
  low_content_rate: ["notice", "Little text compared with code", "Add useful text or cut heavy markup."],
  low_character_count: ["warning", "Thin content", "Expand these pages or noindex them."],
  low_readability_rate: ["notice", "Hard to read", "Shorter sentences and simpler words (grade 6–8)."],
  has_misspelling: ["notice", "Spelling mistakes", "Proofread these pages."],
  lorem_ipsum: ["error", "Placeholder 'lorem ipsum' text", "Replace dummy text before Google indexes it."],
  deprecated_html_tags: ["notice", "Outdated HTML tags", "Theme/content uses tags like <font> or <center>."],
  canonical: ["notice", "No canonical tag", "Add a self-referencing canonical (SEO plugins do this)."],
  recursive_canonical: ["warning", "Canonical loops", "Point canonicals at the final URL."],
  canonical_to_redirect: ["warning", "Canonical points to a redirect", "Point the canonical at the final URL."],
  canonical_to_broken: ["error", "Canonical points to a broken page", "Fix the canonical URL."],
  canonical_chain: ["warning", "Canonical chains", "Point every canonical directly at the final page."],
  redirect_chain: ["warning", "Redirect chains", "Redirect straight to the final URL in one hop."],
  has_meta_refresh_redirect: ["warning", "Meta refresh redirects", "Use 301 redirects instead."],
  has_links_to_redirects: ["notice", "Internal links to redirected URLs", "Update the links to the final URLs."],
  is_orphan_page: ["warning", "Orphan pages (no internal links in)", "Link to them from related pages, or remove them."],
  is_link_relation_conflict: ["notice", "Conflicting follow/nofollow links", "Use the same rel on all links to a page."],
  seo_friendly_url: ["notice", "URLs that aren't SEO-friendly", "Short, lowercase, hyphenated URLs with the keyword."],
  seo_friendly_url_characters_check: ["notice", "URLs with odd characters", "Use only a–z, 0–9 and hyphens."],
  seo_friendly_url_dynamic_check: ["notice", "Dynamic URLs with parameters", "Use clean permalinks."],
  seo_friendly_url_relative_length_check: ["notice", "URLs that are too long", "Shorten the slug."],
  has_micromarkup_errors: ["warning", "Structured data (schema) errors", "Fix the schema markup so it validates."],
  unminified_css: ["notice", "CSS not minified", "Minify with a speed/caching plugin."],
  unminified_js: ["notice", "JavaScript not minified", "Minify with a speed/caching plugin."],
};

const METRIC_ISSUES: Record<string, [Sev, string, string, string]> = {
  broken_links: ["error", "Broken links", "Fix or remove links that lead to errors.", "is_broken"],
  broken_resources: ["warning", "Broken images, CSS or scripts", "Re-upload or remove the missing files.", "broken_resources"],
  duplicate_title: ["warning", "Same title on several pages", "Give every page a unique title.", "duplicate_title"],
  duplicate_description: ["notice", "Same meta description on several pages", "Write a unique description per page.", "duplicate_description"],
  duplicate_content: ["warning", "Duplicate content", "Merge, rewrite, or canonicalise near-identical pages.", "duplicate_content"],
  non_indexable: ["warning", "Pages Google can't index", "Check noindex tags, robots.txt and canonicals on these.", "non_indexable"],
  redirect_loop: ["error", "Redirect loops", "Fix the redirect rules so they end on a real page.", "redirect_loop"],
};

const humanize = (k: string) => k.replace(/_/g, " ").replace(/^is |^has /, "").replace(/^\w/, (c) => c.toUpperCase());
const WEIGHT: Record<Sev, number> = { error: 3, warning: 2, notice: 1 };

export function crawlTarget(siteUrl: string) {
  try { return new URL(siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`).hostname.replace(/^www\./, ""); } catch { return siteUrl; }
}

/** Starts a crawl at DataForSEO. */
/** Secret token DataForSEO sends back when a crawl finishes (so only it can trigger our pingback). */
export function pingbackToken() {
  const secret = process.env.CRON_SECRET || process.env.AUTH_SECRET || "";
  return createHmac("sha256", secret).update("dfs-onpage-pingback").digest("hex").slice(0, 32);
}

/** Starts a crawl at DataForSEO. */
export async function startCrawl(clientId: string, actorId?: string, opts: { scheduled?: boolean } = {}) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { siteUrl: true, auditJsRender: true } });
  if (!client.siteUrl) throw new Error("This client has no website URL");
  const target = crawlTarget(client.siteUrl);
  const maxPages = Number(process.env.DATAFORSEO_AUDIT_MAX_PAGES) || 500;
  const app = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const task = await dfsTask("on_page/task_post", [{
    target, max_crawl_pages: maxPages, load_resources: true, check_spell: false,
    // JavaScript rendering: a real browser runs the page's scripts first (Elementor, Divi, Wix, React sites).
    enable_javascript: client.auditJsRender, ...(client.auditJsRender ? { enable_browser_rendering: true } : {}),
    validate_micromarkup: true, calculate_keyword_density: false, store_raw_html: false, respect_sitemap: true, crawl_sitemap_only: false,
    // DataForSEO calls this when the crawl is finished, so the analysis and email don't wait for someone to open the page.
    ...(app.startsWith("https://") ? { pingback_url: `${app}/api/audit/pingback?task=$id&t=${pingbackToken()}` } : {}),
  }]);
  const crawl = await db.siteCrawl.create({ data: { clientId, taskId: task.id, target, maxPages, startedById: actorId ?? null, scheduled: !!opts.scheduled, jsRender: client.auditJsRender } });
  await logActivity({ actorId, clientId, action: opts.scheduled ? "audit.scheduled_start" : "audit.full_start", entity: "client", entityId: clientId, after: { target, maxPages, jsRender: client.auditJsRender } });
  return crawl;
}

type Summary = {
  crawl_progress: "in_progress" | "finished";
  crawl_status?: { max_crawl_pages: number; pages_in_queue: number; pages_crawled: number };
  domain_info?: Record<string, unknown> & { checks?: Record<string, boolean>; total_pages?: number };
  page_metrics?: Record<string, number> & { checks?: Record<string, number>; onpage_score?: number };
};

async function samples(taskId: string, filter: unknown[]) {
  try {
    const r = await dfsPost<{ items?: { url: string }[] }>("on_page/pages", [{ id: taskId, filters: [filter], limit: 10 }], 20_000);
    return (r[0]?.items ?? []).map((i) => i.url);
  } catch {
    return [];
  }
}

async function count(taskId: string, filters: unknown[]) {
  try {
    const r = await dfsPost<{ total_items_count?: number; items?: { url: string }[] }>("on_page/pages", [{ id: taskId, filters, limit: 10 }], 20_000);
    return { total: r[0]?.total_items_count ?? r[0]?.items?.length ?? 0, urls: (r[0]?.items ?? []).map((i) => i.url) };
  } catch {
    return null;
  }
}

async function brokenLinks(taskId: string) {
  try {
    const r = await dfsPost<{ items?: { page_from?: string; link_from?: string; link_to?: string; page_to?: string; page_to_status_code?: number }[] }>("on_page/links", [{ id: taskId, filters: [["is_broken", "=", true]], limit: 30 }], 20_000);
    return (r[0]?.items ?? []).map((l) => ({ from: l.page_from ?? l.link_from ?? "", to: l.link_to ?? l.page_to ?? "", status: l.page_to_status_code })).filter((l) => l.from && l.to);
  } catch {
    return [];
  }
}

async function duplicateGroups(taskId: string, type: "duplicate_title" | "duplicate_description") {
  try {
    const r = await dfsPost<{ items?: { accumulator?: string; pages?: { url: string }[] }[] }>("on_page/duplicate_tags", [{ id: taskId, type, limit: 10 }], 20_000);
    return (r[0]?.items ?? []).map((g) => ({ value: String(g.accumulator ?? ""), urls: (g.pages ?? []).map((p) => p.url).slice(0, 10) })).filter((g) => g.urls.length > 1);
  } catch {
    return [];
  }
}

const HTML_OK = [["resource_type", "=", "html"], "and", ["status_code", "=", 200]];

/** Builds the issue list from a finished crawl's summary. */
async function buildIssues(taskId: string, s: Summary): Promise<CrawlIssue[]> {
  const crawled = s.crawl_status?.pages_crawled ?? 0;
  const pm = s.page_metrics ?? {};
  const checks = pm.checks ?? {};
  const found: (Omit<CrawlIssue, "urls"> & { urls?: string[] })[] = [];
  // "Positive" checks (true = good) used to be counted as crawled - passed, which also counted every redirect,
  // 404 and image as failing. Count only real HTML pages that load, straight from the crawl.
  const positive = await Promise.all(Object.keys(checks).filter((c) => POSITIVE.has(c) && !IGNORE.has(c)).map(async (c) => [c, await count(taskId, [[`checks.${c}`, "=", false], "and", ...HTML_OK])] as const));
  const posMap = new Map(positive);
  for (const [code, n] of Object.entries(checks)) {
    if (IGNORE.has(code)) continue;
    let bad = n;
    let urls: string[] | undefined;
    if (POSITIVE.has(code)) {
      const r = posMap.get(code);
      bad = r ? r.total : Math.max(0, crawled - n);
      urls = r?.urls;
    }
    if (!bad) continue;
    const [severity, title, hint] = CATALOG[code] ?? ["notice", humanize(code), ""];
    found.push({ code, severity, title, hint, count: bad, urls });
  }
  // "Broken pages" repeats the 4xx/5xx lists; keep the more specific ones.
  const errPages = (checks.is_4xx_code ?? 0) + (checks.is_5xx_code ?? 0);
  const brokenAt = found.findIndex((f) => f.code === "is_broken");
  if (brokenAt >= 0 && errPages && found[brokenAt].count <= errPages) found.splice(brokenAt, 1);
  for (const [key, [severity, title, hint]] of Object.entries(METRIC_ISSUES)) {
    const n = Number(pm[key] ?? 0);
    if (n > 0 && !found.some((f) => f.title === title)) found.push({ code: key, severity, title, hint, count: n });
  }
  found.sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity] || b.count - a.count);

  // Example URLs for the most important issues.
  return Promise.all(found.map(async (f, i): Promise<CrawlIssue> => {
    if (f.urls) return { ...f, urls: f.urls };
    if (i >= 20) return { ...f, urls: [] };
    if (f.code === "broken_links") {
      const links = await brokenLinks(taskId);
      const pages = links.length ? [...new Set(links.map((l) => l.from))].slice(0, 10) : (await count(taskId, [["broken_links", "=", true]]))?.urls ?? [];
      return { ...f, urls: pages, links: links.slice(0, 20) };
    }
    if (f.code === "duplicate_title" || f.code === "duplicate_description") {
      const groups = await duplicateGroups(taskId, f.code);
      if (groups.length) return { ...f, urls: [...new Set(groups.flatMap((g) => g.urls))].slice(0, 10), groups };
    }
    const metric = METRIC_ISSUES[f.code];
    const filter = metric
      ? (f.code === "non_indexable" ? ["meta.robots", "like", "%noindex%"] : f.code === "redirect_loop" ? ["checks.redirect_chain", "=", true] : [metric[3], "=", true])
      : [`checks.${f.code}`, "=", true];
    return { ...f, urls: await samples(taskId, filter) };
  }));
}

/** Rebuilds the issue list of a finished crawl (DataForSEO keeps crawl results for 30 days). */
export async function refreshIssues(crawl: SiteCrawl) {
  if (!crawl.taskId || crawl.status !== "DONE") return crawl;
  const s = (await dfsPost<Summary>(`on_page/summary/${crawl.taskId}`, [], 25_000))[0];
  if (!s || s.crawl_progress !== "finished") return crawl;
  const issues = await buildIssues(crawl.taskId, s);
  return db.siteCrawl.update({ where: { id: crawl.id }, data: { issues: issues as unknown as Prisma.InputJsonValue } });
}

export type IssueChange = { code: string; title: string; severity: Sev; from: number; to: number };
/** What changed since the previous audit: new problems, fixed ones, and ones that got worse or better. */
export function compareIssues(prev: CrawlIssue[], cur: CrawlIssue[]) {
  const before = new Map(prev.map((i) => [i.code, i]));
  const now = new Map(cur.map((i) => [i.code, i]));
  const added: IssueChange[] = [], fixed: IssueChange[] = [], worse: IssueChange[] = [], better: IssueChange[] = [];
  for (const i of cur) {
    const p = before.get(i.code);
    const c = { code: i.code, title: i.title, severity: i.severity, from: p?.count ?? 0, to: i.count };
    if (!p) added.push(c); else if (i.count > p.count) worse.push(c); else if (i.count < p.count) better.push(c);
  }
  for (const p of prev) if (!now.has(p.code)) fixed.push({ code: p.code, title: p.title, severity: p.severity, from: p.count, to: 0 });
  return { added, fixed, worse, better };
}

/** Checks progress; when the crawl is finished, builds the issue list. Safe to call often. */
export async function pollCrawl(crawl: SiteCrawl, force = false) {
  if (crawl.status !== "RUNNING" || !crawl.taskId) return crawl;
  if (!force && crawl.lastPolledAt && Date.now() - crawl.lastPolledAt.getTime() < 15_000) return crawl;
  if (Date.now() - crawl.startedAt.getTime() > 6 * 3600_000) {
    return db.siteCrawl.update({ where: { id: crawl.id }, data: { status: "FAILED", error: "The crawl took more than 6 hours", finishedAt: new Date() } });
  }
  let s: Summary | undefined;
  try {
    s = (await dfsPost<Summary>(`on_page/summary/${crawl.taskId}`, [], 25_000))[0];
  } catch (e) {
    return db.siteCrawl.update({ where: { id: crawl.id }, data: { lastPolledAt: new Date(), error: e instanceof Error ? e.message : String(e) } });
  }
  if (!s) return db.siteCrawl.update({ where: { id: crawl.id }, data: { lastPolledAt: new Date() } });
  const crawled = s.crawl_status?.pages_crawled ?? 0;
  if (s.crawl_progress !== "finished") {
    return db.siteCrawl.update({ where: { id: crawl.id }, data: { lastPolledAt: new Date(), pagesCrawled: crawled, pagesInQueue: s.crawl_status?.pages_in_queue ?? 0, error: null } });
  }

  const pm = s.page_metrics ?? {};
  const issues = await buildIssues(crawl.taskId, s);

  const { checks: dChecks, ...domain } = s.domain_info ?? {};
  const { checks: _c, ...metrics } = pm;
  void _c;
  const done = await db.siteCrawl.update({
    where: { id: crawl.id },
    data: {
      status: "DONE", finishedAt: new Date(), lastPolledAt: new Date(), pagesCrawled: crawled, pagesInQueue: 0,
      score: pm.onpage_score != null ? Math.round(pm.onpage_score) : null,
      domainInfo: { ...domain, checks: dChecks ?? {} } as Prisma.InputJsonValue,
      metrics: metrics as Prisma.InputJsonValue,
      issues: issues as unknown as Prisma.InputJsonValue,
      error: null,
    },
  });
  return done;
}
