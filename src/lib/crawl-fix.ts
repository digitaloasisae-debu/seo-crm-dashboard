/**
 * AI fix plans for site-audit issues: step-by-step instructions for the client's CMS, and for
 * page-level issues (titles, meta descriptions, H1s, alt text, thin content) the exact text to use
 * on each example page, written from the page's real content.
 */
import { parse } from "node-html-parser";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { geminiJson } from "./gemini";
import type { CrawlIssue } from "./crawl";

export type CrawlFix = {
  summary: string;
  why: string;
  steps: string[];
  effort: string;
  pages: { url: string; current: string; suggested: string }[];
  createdAt: string;
};

/** Issues where we fetch the example pages and write replacement text for each one. */
const PAGE_LEVEL: Record<string, string> = {
  no_title: "Write a title tag (50–60 characters, main keyword first, brand at the end).",
  title_too_long: "Rewrite the title to at most 60 characters, keeping the main keyword at the front.",
  title_too_short: "Rewrite the title to 50–60 characters: keyword + benefit + brand.",
  irrelevant_title: "Rewrite the title so it matches what the page is about.",
  duplicate_title: "Write a unique title for this page (50–60 characters).",
  duplicate_title_tag: "Give the single title this page should keep.",
  no_description: "Write a meta description (140–160 characters) with the keyword and a reason to click.",
  irrelevant_description: "Rewrite the meta description to summarise this page (140–160 characters).",
  duplicate_description: "Write a unique meta description for this page (140–160 characters).",
  no_h1_tag: "Write one H1 heading for this page with its main keyword.",
  no_image_alt: "Write alt text for each image listed (short, descriptive, keyword only where natural). Format: image file → alt text, one per line.",
  low_character_count: "List the 3–5 sections to add to make this page genuinely useful (with H2 headings and one line on what each covers).",
  irrelevant_meta_keywords: "Say what to do with the meta keywords tag.",
};

type PageInfo = { url: string; title: string; description: string; h1: string[]; text: string; images: string[] };

async function readPage(url: string): Promise<PageInfo | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; RankflowAudit/1.0)" }, signal: AbortSignal.timeout(10_000), redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const root = parse(await res.text());
    root.querySelectorAll("script,style,noscript,svg").forEach((n) => n.remove());
    const images = root.querySelectorAll("img").filter((i) => !(i.getAttribute("alt") ?? "").trim()).map((i) => (i.getAttribute("src") ?? i.getAttribute("data-src") ?? "").split("/").pop() ?? "").filter(Boolean).slice(0, 6);
    const main = root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector("body");
    return {
      url,
      title: root.querySelector("title")?.text.trim() ?? "",
      description: root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "",
      h1: root.querySelectorAll("h1").map((h) => h.text.trim()).filter(Boolean).slice(0, 3),
      text: (main?.structuredText ?? "").replace(/\s+/g, " ").trim().slice(0, 1200),
      images,
    };
  } catch {
    return null;
  }
}

const SYSTEM = `You are a senior technical SEO who explains fixes to a small agency team that is NOT technical.
Return JSON: {"summary": string, "why": string, "steps": string[], "effort": string, "pages": [{"url": string, "current": string, "suggested": string}]}
- summary: one sentence on what the problem is, in plain words.
- why: one sentence on why it matters for Google rankings or visitors.
- steps: 3–7 short, numbered-in-order click-by-click steps for the site's CMS (for WordPress, name the exact menu, e.g. "Yoast SEO → Search Appearance" or "Rank Math → Titles & Meta", or a specific free plugin). No code unless unavoidable; if code is needed, say exactly where it goes.
- effort: e.g. "5 minutes", "about 1 hour", "needs a developer".
- pages: only when page details are given: one entry per page with the current value and your exact suggested replacement, written for the business and city. Otherwise [].
Never invent facts about the business (prices, years, awards).`;

/** Builds (and saves) the AI fix plan for one issue of a finished crawl. */
export async function fixCrawlIssue(crawlId: string, code: string): Promise<CrawlFix> {
  const crawl = await db.siteCrawl.findUniqueOrThrow({ where: { id: crawlId }, include: { client: { select: { name: true, businessType: true, primaryCity: true, servicesOffered: true, cmsPlatform: true } } } });
  const issue = ((crawl.issues as unknown as CrawlIssue[] | null) ?? []).find((i) => i.code === code);
  if (!issue) throw new Error("This issue isn't in the audit anymore");
  const domain = (crawl.domainInfo ?? {}) as Record<string, unknown>;
  const cms = crawl.client.cmsPlatform || (domain.cms ? String(domain.cms) : "WordPress");
  const task = PAGE_LEVEL[code];
  const pages = task ? (await Promise.all(issue.urls.slice(0, 5).map(readPage))).filter((p): p is PageInfo => !!p) : [];

  const prompt = [
    `Website: ${crawl.target} (${crawl.client.name}${crawl.client.businessType ? `, ${crawl.client.businessType}` : ""}${crawl.client.primaryCity ? `, ${crawl.client.primaryCity}` : ""})`,
    crawl.client.servicesOffered.length ? `Services: ${crawl.client.servicesOffered.slice(0, 8).join(", ")}` : "",
    `CMS: ${cms}${domain.server ? ` · Server: ${String(domain.server)}` : ""}`,
    `Audit issue: "${issue.title}" (check code ${issue.code}, severity ${issue.severity}) on ${issue.count} of ${crawl.pagesCrawled} pages.`,
    issue.hint ? `Short hint already shown: ${issue.hint}` : "",
    issue.urls.length ? `Example URLs:\n${issue.urls.slice(0, 10).join("\n")}` : "",
    task && pages.length ? `For each page below: ${task}\n\n${pages.map((p) => `URL: ${p.url}\nTitle: ${p.title || "(none)"}\nMeta description: ${p.description || "(none)"}\nH1: ${p.h1.join(" | ") || "(none)"}${code === "no_image_alt" ? `\nImages without alt: ${p.images.join(", ") || "(none found)"}` : ""}\nContent: ${p.text}`).join("\n\n---\n\n")}` : "",
  ].filter(Boolean).join("\n");

  const r = await geminiJson<Omit<CrawlFix, "createdAt">>(prompt, { system: SYSTEM, timeoutMs: 55_000, temperature: 0.3 });
  const fix: CrawlFix = {
    summary: String(r.summary ?? ""),
    why: String(r.why ?? ""),
    steps: Array.isArray(r.steps) ? r.steps.map(String).slice(0, 10) : [],
    effort: String(r.effort ?? ""),
    pages: Array.isArray(r.pages) ? r.pages.filter((p) => p && p.url).map((p) => ({ url: String(p.url), current: String(p.current ?? ""), suggested: String(p.suggested ?? "") })).slice(0, 10) : [],
    createdAt: new Date().toISOString(),
  };
  // Re-read so two fixes generated at once don't overwrite each other.
  const fresh = await db.siteCrawl.findUniqueOrThrow({ where: { id: crawlId }, select: { aiFixes: true } });
  const all = { ...((fresh.aiFixes ?? {}) as Record<string, CrawlFix>), [code]: fix };
  await db.siteCrawl.update({ where: { id: crawlId }, data: { aiFixes: all as unknown as Prisma.InputJsonValue } });
  return fix;
}
