/**
 * Content refresh finder: pages whose Google clicks have dropped (last 4 weeks vs. their best
 * 4 weeks before that), and an AI plan to update each one. Pages written by Rankflow can be
 * rewritten with the plan and go back through review; other pages get a brief to follow.
 */
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { geminiJson } from "./gemini";
import { brandContext } from "./brand-profile";
import { reviseArticle } from "./revise";
import { gscPageQuery } from "./google";

const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
const MIN_BEFORE = 20;
const DROP = 0.7;

export type LostQuery = { query: string; before: number; now: number; posBefore: number | null; posNow: number | null };

const DAY = 864e5;
const plus = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

/** Which searches this page lost clicks on: its best 4 weeks vs the latest 4 weeks, per query. */
export async function lostQueriesFor(clientId: string, page: string, bestFrom: Date, nowFrom: Date): Promise<LostQuery[]> {
  const [before, now] = await Promise.all([
    gscPageQuery(clientId, page, bestFrom, plus(bestFrom, 27)),
    gscPageQuery(clientId, page, nowFrom, plus(nowFrom, 27)),
  ]);
  const map = new Map<string, LostQuery>();
  for (const r of before) map.set(r.keys[0], { query: r.keys[0], before: r.clicks, now: 0, posBefore: r.position, posNow: null });
  for (const r of now) {
    const q = map.get(r.keys[0]) ?? { query: r.keys[0], before: 0, now: 0, posBefore: null, posNow: null };
    q.now = r.clicks; q.posNow = r.position;
    map.set(r.keys[0], q);
  }
  return [...map.values()]
    .filter((q) => q.before - q.now > 0)
    .sort((a, b) => b.before - b.now - (a.before - a.now))
    .slice(0, 12);
}

export type RefreshBrief = {
  summary: string;
  why: string[];
  title: string;
  metaDescription: string;
  add: string[];
  update: string[];
  remove: string[];
  faqs: string[];
  instructions: string;
};

/** Scan Search Console weeks for pages losing clicks. Returns how many are flagged now. */
export async function findRefreshes(clientId: string) {
  const since = new Date(Date.now() - 13 * 7 * 864e5);
  const rows = await db.gscPageWeek.findMany({ where: { clientId, weekStart: { gte: since } }, select: { page: true, weekStart: true, clicks: true, impressions: true, position: true }, orderBy: { weekStart: "asc" } });
  if (!rows.length) return 0;
  const weeks = [...new Set(rows.map((r) => r.weekStart.toISOString().slice(0, 10)))].sort();
  // The newest week may be incomplete; leave it out.
  const usable = weeks.slice(0, -1);
  if (usable.length < 8) return 0;
  const recentW = new Set(usable.slice(-4));
  const earlier = usable.slice(0, -4);
  const byPage = new Map<string, typeof rows>();
  for (const r of rows) byPage.set(r.page, [...(byPage.get(r.page) ?? []), r]);

  const articles = await db.article.findMany({ where: { clientId, wpPostUrl: { not: null } }, select: { id: true, wpPostUrl: true, slug: true } });
  const flagged: string[] = [];
  for (const [page, rs] of byPage) {
    const wk = (w: string) => rs.find((r) => r.weekStart.toISOString().slice(0, 10) === w);
    const now = [...recentW].reduce((a, w) => a + (wk(w)?.clicks ?? 0), 0);
    let best = 0, bestStart = 0;
    for (let i = 0; i + 4 <= earlier.length; i++) {
      const s = earlier.slice(i, i + 4).reduce((a, w) => a + (wk(w)?.clicks ?? 0), 0);
      if (s > best) { best = s; bestStart = i; }
    }
    if (best < MIN_BEFORE || now > best * DROP) continue;
    const avgPos = (ws: string[]) => {
      const xs = ws.map(wk).filter(Boolean) as typeof rows;
      const imp = xs.reduce((a, x) => a + x.impressions, 0);
      return imp ? xs.reduce((a, x) => a + x.position * x.impressions, 0) / imp : null;
    };
    const posBefore = avgPos(earlier.slice(bestStart, bestStart + 4));
    const posNow = avgPos([...recentW]);
    const slug = norm(page).split("/").pop();
    const article = articles.find((a) => (a.wpPostUrl && norm(a.wpPostUrl) === norm(page)) || (slug && a.slug === slug));
    const existing = await db.contentRefresh.findUnique({ where: { clientId_page: { clientId, page } } });
    if (existing?.status === "DISMISSED") continue;
    // An updated page gets 60 days to recover before it can be flagged again.
    if (existing?.status === "DONE" && (existing.doneAt ?? existing.updatedAt) > new Date(Date.now() - 60 * DAY)) continue;
    const bestFrom = new Date(`${earlier[bestStart]}T00:00:00Z`);
    const nowFrom = new Date(`${usable.at(-4)}T00:00:00Z`);
    const reopen = existing?.status === "DONE" ? { status: "OPEN" as const, brief: Prisma.DbNull, doneAt: null, baseClicks: null, basePos: null, afterClicks: null, afterPos: null, afterAt: null } : {};
    const row = await db.contentRefresh.upsert({
      where: { clientId_page: { clientId, page } },
      create: { clientId, page, clicksBefore: best, clicksNow: now, posBefore, posNow, bestFrom, nowFrom, articleId: article?.id ?? null },
      update: { clicksBefore: best, clicksNow: now, posBefore, posNow, bestFrom, nowFrom, articleId: article?.id ?? null, ...reopen },
    });
    // Which searches it lost: refreshed weekly (2 Search Console calls per page).
    if (!row.queriesAt || row.queriesAt < new Date(Date.now() - 7 * DAY) || row.nowFrom?.getTime() !== existing?.nowFrom?.getTime()) {
      try {
        const lost = await lostQueriesFor(clientId, page, bestFrom, nowFrom);
        await db.contentRefresh.update({ where: { id: row.id }, data: { lostQueries: lost as unknown as Prisma.InputJsonValue, queriesAt: new Date() } });
      } catch (e) {
        console.error("Lost queries failed for", page, e);
      }
    }
    flagged.push(page);
  }
  await measureResults(clientId, usable, byPage);
  // Pages that recovered drop off the list.
  await db.contentRefresh.deleteMany({ where: { clientId, status: "OPEN", page: { notIn: flagged } } });
  return flagged.length;
}

/** When the update went live: the WordPress push of the rewritten article, or when it was marked as updated. */
export async function liveSince(r: { doneAt: Date | null; articleId: string | null }) {
  if (!r.doneAt) return null;
  if (!r.articleId) return r.doneAt;
  const a = await db.article.findUnique({ where: { id: r.articleId }, select: { pushedAt: true, status: true, wpBuilder: true } });
  if (!a || a.wpBuilder) return r.doneAt;
  // A Rankflow rewrite only counts once it has been pushed to WordPress after the refresh.
  return a.status === "PUSHED_DRAFT" && a.pushedAt && a.pushedAt >= plus(r.doneAt, -1) ? a.pushedAt : null;
}

/** Before/after: 4 full weeks of clicks, starting one week after the update went live (Google needs time to recrawl). */
async function measureResults(clientId: string, usable: string[], byPage: Map<string, { weekStart: Date; clicks: number; impressions: number; position: number }[]>) {
  const done = await db.contentRefresh.findMany({ where: { clientId, status: "DONE", doneAt: { not: null }, afterAt: null } });
  for (const r of done) {
    const live = await liveSince(r);
    if (!live) continue;
    const startAt = plus(live, 7);
    const weeks = usable.filter((w) => new Date(`${w}T00:00:00Z`) >= startAt).slice(0, 4);
    if (weeks.length < 4) continue;
    const rs = (byPage.get(r.page) ?? []).filter((x) => weeks.includes(x.weekStart.toISOString().slice(0, 10)));
    const clicks = rs.reduce((a, x) => a + x.clicks, 0);
    const imp = rs.reduce((a, x) => a + x.impressions, 0);
    const pos = imp ? rs.reduce((a, x) => a + x.position * x.impressions, 0) / imp : null;
    await db.contentRefresh.update({ where: { id: r.id }, data: { afterClicks: clicks, afterPos: pos, afterAt: new Date() } });
  }
}

/** Mark a page as updated and remember its clicks at that moment, so the result can be compared 5 weeks later. */
export async function markRefreshDone(refreshId: string) {
  const r = await db.contentRefresh.findUniqueOrThrow({ where: { id: refreshId } });
  await db.contentRefresh.update({ where: { id: refreshId }, data: { status: "DONE", doneAt: new Date(), baseClicks: r.clicksNow, basePos: r.posNow, afterClicks: null, afterPos: null, afterAt: null } });
}

const strip = (html: string) =>
  html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(h[1-6]|p|li)>/gi, "\n").replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n${"#".repeat(Number(n))} `).replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

/** Ask the AI why the page is slipping and what to change. */
export async function draftRefresh(refreshId: string) {
  const r = await db.contentRefresh.findUniqueOrThrow({ where: { id: refreshId }, include: { client: { select: { id: true, name: true, primaryCity: true } } } });
  try {
    const article = r.articleId ? await db.article.findUnique({ where: { id: r.articleId }, select: { metaTitle: true, metaDescription: true, bodyHtml: true, focusKeyword: true } }) : null;
    let text = article ? strip(article.bodyHtml) : "";
    let title = article?.metaTitle ?? "";
    if (!text) {
      const res = await fetch(r.page, { headers: { "User-Agent": "Mozilla/5.0 (compatible; RankflowBot/1.0)" }, signal: AbortSignal.timeout(20_000) });
      const html = await res.text();
      title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
      text = strip(html.match(/<(article|main)[\s\S]*<\/\1>/i)?.[0] ?? html);
    }
    const brand = await brandContext(r.clientId);
    const lost = (r.lostQueries as unknown as LostQuery[] | null) ?? [];
    const brief = await geminiJson<RefreshBrief>(
      `This page on ${r.client.name}'s website is losing Google traffic. Plan an update that wins it back.
Today is ${new Date().toISOString().slice(0, 10)}.

PAGE: ${r.page}
Title: ${title}
${article ? `Focus keyword: ${article.focusKeyword}\n` : ""}Google clicks: ${r.clicksBefore} in its best 4 weeks, ${r.clicksNow} in the last 4 weeks.
Average position: ${r.posBefore?.toFixed(1) ?? "?"} then, ${r.posNow?.toFixed(1) ?? "?"} now.
${lost.length ? `Searches it lost clicks on (clicks then -> now, position then -> now):\n${lost.map((q) => `- "${q.query}": ${q.before} -> ${q.now}, position ${q.posBefore?.toFixed(1) ?? "-"} -> ${q.posNow?.toFixed(1) ?? "not ranking"}`).join("\n")}\nMake sure the update targets these searches.\n` : ""}
${brand ? `${brand}\n\n` : ""}PAGE TEXT:
${text.slice(0, 12000)}

Think about: outdated years, prices or facts; missing subtopics searchers now expect; thin sections; weak title or meta description; missing FAQ; search intent drift; local signals${r.client.primaryCity ? ` for ${r.client.primaryCity}` : ""}.
Never invent facts about the business.
Return JSON: {"summary":"1-2 sentences: what's wrong and the plan","why":["likely reasons traffic dropped"],"title":"improved SEO title under 60 characters","metaDescription":"150-160 characters","add":["sections or points to add"],"update":["things to update or correct"],"remove":["things to cut"],"faqs":["questions to answer"],"instructions":"one paragraph of rewrite instructions for an AI writer"}`,
      { timeoutMs: 120_000, temperature: 0.4 },
    );
    await db.contentRefresh.update({ where: { id: refreshId }, data: { brief, status: "DRAFTED", error: null, draftingAt: null } });
  } catch (e) {
    await db.contentRefresh.update({ where: { id: refreshId }, data: { error: e instanceof Error ? e.message : String(e), draftingAt: null } });
  }
}

/** Rewrite the Rankflow article with the plan; it goes back to review, then "Push" updates the WordPress post. */
export async function applyRefresh(refreshId: string, userId: string) {
  const r = await db.contentRefresh.findUniqueOrThrow({ where: { id: refreshId } });
  if (!r.articleId) throw new Error("This page wasn't written in Rankflow, so use the brief instead");
  const b = r.brief as unknown as RefreshBrief | null;
  if (!b) throw new Error("Draft the plan first");
  const art = await db.article.findUnique({ where: { id: r.articleId }, select: { wpBuilder: true } });
  if (art?.wpBuilder) throw new Error("This page is built with a page builder, so update it in WordPress using the plan");
  const instructions = `CONTENT REFRESH (this live page is losing Google clicks). ${b.instructions}
New SEO title: ${b.title}
New meta description: ${b.metaDescription}
Add: ${b.add.join("; ")}
Update: ${b.update.join("; ")}
Remove: ${b.remove.join("; ")}
Answer these FAQs: ${b.faqs.join("; ")}`;
  await reviseArticle(r.articleId, { instructions, userId });
  const a = await db.article.findUniqueOrThrow({ where: { id: r.articleId }, select: { reviseError: true, status: true } });
  if (a.reviseError) throw new Error(a.reviseError);
  if (a.status === "PUSHED_DRAFT" || a.status === "PUSH_FAILED") await db.article.update({ where: { id: r.articleId }, data: { status: "READY_FOR_REVIEW", approvedAt: null, approvedById: null } });
  await markRefreshDone(refreshId);
}
