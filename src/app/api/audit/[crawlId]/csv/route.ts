import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { requireClientAccess } from "@/lib/access";
import type { CrawlIssue } from "@/lib/crawl";
import type { CrawlDeep, DeepPage } from "@/lib/crawl-deep";
import type { CrawlFix } from "@/lib/crawl-fix";

const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
};

/** Every issue and example URL (plus the deep-analysis page lists) as a spreadsheet-ready CSV. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ crawlId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const { crawlId } = await params;
  const crawl = await db.siteCrawl.findUnique({ where: { id: crawlId }, include: { client: { select: { slug: true } } } });
  if (!crawl || crawl.status !== "DONE") return NextResponse.json({ error: "Audit not found or not finished" }, { status: 404 });
  try {
    await requireClientAccess(user, crawl.clientId, "view");
  } catch {
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }
  const issues = (crawl.issues as unknown as CrawlIssue[] | null) ?? [];
  const fixes = (crawl.aiFixes ?? {}) as Record<string, CrawlFix>;
  const deep = crawl.advanced as unknown as CrawlDeep | null;
  const rows: unknown[][] = [["Type", "Severity", "Issue", "Pages affected", "URL", "Detail", "How to fix"]];
  for (const i of issues) {
    const fix = fixes[i.code];
    const how = fix ? [fix.summary, ...fix.steps.map((s, k) => `${k + 1}. ${s.replace(/^\s*\d+[.)]\s*/, "")}`)].join(" ") : i.hint;
    const suggested = new Map((fix?.pages ?? []).map((p) => [p.url, p.suggested]));
    const lines: [string, string][] = i.links?.length
      ? i.links.map((l) => [l.from, `links to ${l.to}${l.status ? ` (${l.status})` : ""}`])
      : i.groups?.length
        ? i.groups.flatMap((g) => g.urls.map((u) => [u, `shared: ${g.value}`] as [string, string]))
        : i.urls.map((u) => [u, suggested.get(u) ? `suggested: ${suggested.get(u)}` : ""]);
    if (!lines.length) rows.push(["Issue", i.severity, i.title, i.count, "", "", how]);
    for (const [u, d] of lines) rows.push(["Issue", i.severity, i.title, i.count, u, d, how]);
  }
  if (deep) {
    const list = (name: string, items: DeepPage[] | undefined, unit: string) => (items ?? []).forEach((p) => rows.push(["Page list", "", name, items!.length, p.url, `${p.value} ${unit}`.trim(), ""]));
    list("Weakly linked pages", deep.weakLinked, "internal links in");
    list("Buried pages (over 3 clicks)", deep.deepPages, "clicks");
    list("Thin pages", deep.thinPages, "words");
    list("Heavy pages", deep.heavyPages, "bytes");
    list("Large images", deep.bigImages, "bytes");
    list("Slow pages", deep.slowPages, "ms");
    list("Pages Google isn't showing", deep.indexing?.noImpressions, "links in");
    list("Getting impressions but not found by the crawl", deep.indexing?.notCrawled, "impressions");
    list("Sitemap URLs that redirect or error", deep.files?.sitemapBad, "status");
    list("Live pages missing from the sitemap", deep.files?.notInSitemap, "links in");
    for (const c of deep.cannibal) for (const p of c.pages) rows.push(["Cannibalisation", "", c.query, c.pages.length, p.url, `position ${p.position}, ${p.impressions} impressions`, ""]);
  }
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const name = `seo-audit-${crawl.client.slug}-${(crawl.finishedAt ?? crawl.startedAt).toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
}
