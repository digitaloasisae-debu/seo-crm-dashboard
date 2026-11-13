/** Runs the SOP checker on an article: rule checks always, plus a Gemini review when asked. */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { checkArticle, type CheckItem } from "./sop-check";
import { geminiConfigured, geminiJson } from "./gemini";
import { getSop } from "./sop";
import { cachedResearch } from "./research";

export type QualityReport = {
  ruleScore: number;
  aiScore?: number;
  wordCount: number;
  local: boolean;
  items: CheckItem[];
  ai?: { items: CheckItem[]; summary: string; topFixes: string[] };
  aiError?: string;
  aiHash?: string;
};

const SYSTEM = `You are a strict SEO editor checking a blog article against the agency's SOP and the client's brain (their learned preferences).
Measurable items (word count, link counts, meta lengths, title number/power/sentiment words, slug, keyword placement, competitor keywords and PAA questions in headings and FAQ, paragraph length, transition words, bold answer, AI phrases, readability, image count) are already checked by code; do NOT repeat them.
Judge ONLY the qualitative items listed below, each as "pass", "warn" or "fail" with a one-sentence reason quoting the article where useful.
Return JSON: {"items":[{"id":"...","label":"...","status":"pass|warn|fail","detail":"..."}],"summary":"<2 sentences>","top_fixes":["<max 5 specific fixes, most important first>"]}`;

const AI_ITEMS = [
  ["intent", "Matches the search intent of the keyword"],
  ["on_title", "Every section helps answer the title; nothing off-topic"],
  ["value", "Original, actionable and solves the reader's problem"],
  ["secondary_kw", "Secondary keywords and PAA questions in the headings read naturally, with no stuffing or repeated phrases"],
  ["coverage", "Covers what the top competitors cover, plus what they miss, without drifting off the title"],
  ["snippets", "Optimised for featured snippets (lists, tables, Q&A)"],
  ["faq_quality", "FAQs are distinct, searched-as-asked questions that relate to the title, answered in the first sentence"],
  ["human", "Reads like a person wrote it: varied sentence starts, no AI rhythm patterns (\"not just X but Y\", threes everywhere, dramatic one-line closers)"],
  ["variety", "Structure and opening differ from the client's last 3 blogs (listed below)"],
  ["tone", "Tone is conversational but professional, no jargon or fluff"],
  ["grammar", "Grammar and spelling are clean (Grammarly 90+ level)"],
  ["brain", "Follows the client's brain rules"],
] as const;
const LOCAL_ITEMS = [
  ["local_phrasing", "Hyper-local phrasing (e.g. homeowners in [City])"],
  ["local_refs", "References local landmarks, climate or regulations where natural"],
  ["trend", "Ties to a current trend or a common local problem"],
] as const;

export async function runQuality(articleId: string, opts: { ai?: boolean } = {}) {
  const article = await db.article.findUniqueOrThrow({
    where: { id: articleId },
    include: { client: { select: { id: true, name: true, siteUrl: true, primaryCity: true, competitors: true, ctaLink: true, ctaText: true, brain: true } } },
  });
  const research = article.focusKeyword ? await cachedResearch(article.client.id, article.focusKeyword).catch(() => null) : null;
  const rule = checkArticle(article, article.client, research ? { secondary: research.secondaryKeywords.map((k) => k.keyword), paa: research.paa } : null);
  // SOP Step 1.7 / Rank Math: the focus keyword isn't the focus keyword of another post on the site.
  if (article.focusKeyword.trim()) {
    const dupes = await db.article.findMany({ where: { clientId: article.client.id, id: { not: article.id }, focusKeyword: { equals: article.focusKeyword.trim(), mode: "insensitive" } }, select: { metaTitle: true }, take: 3 });
    rule.items.push({ id: "kw_unique", group: "Title & meta", label: "Focus keyword not used on another post", status: dupes.length ? "fail" : "pass", detail: dupes.length ? `Also the focus keyword of: ${dupes.map((d) => `"${d.metaTitle}"`).join(", ")}` : "Unique on this site", weight: 1.5 });
    const value = { pass: 1, warn: 0.5, fail: 0 } as const;
    const tw = rule.items.reduce((n, i) => n + (i.weight ?? 1), 0);
    rule.score = Math.round((rule.items.reduce((n, i) => n + value[i.status] * (i.weight ?? 1), 0) / tw) * 100);
  }
  const report: QualityReport = { ruleScore: rule.score, wordCount: rule.wordCount, local: rule.local, items: rule.items };
  const prev = article.qualityReport as unknown as QualityReport | null;
  const hash = createHash("sha1").update(`${article.metaTitle}|${article.metaDescription}|${article.focusKeyword}|${article.bodyHtml}`).digest("hex");

  if (opts.ai && geminiConfigured()) {
    try {
      const wanted = [...AI_ITEMS, ...(rule.local ? LOCAL_ITEMS : [])];
      const sop = await getSop();
      const recent = await db.article.findMany({ where: { clientId: article.client.id, id: { not: article.id } }, orderBy: { createdAt: "desc" }, take: 3, select: { metaTitle: true, bodyHtml: true } });
      const outline = (h: string) => [...h.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).slice(0, 10).join(" | ");
      const opening = (h: string) => (h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "").replace(/<[^>]+>/g, "").slice(0, 200);
      const last3 = recent.map((r, i) => `${i + 1}. ${r.metaTitle}\n   Opening: ${opening(r.bodyHtml)}\n   H2s: ${outline(r.bodyHtml)}`).join("\n") || "(none)";
      const plain = article.bodyHtml.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<\/(p|h[1-6]|li|tr)>/gi, "\n").replace(/<h([1-6])[^>]*>/gi, (_m, l) => `${"#".repeat(Number(l))} `).replace(/<li[^>]*>/gi, "- ").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").slice(0, 30000);
      const out = await geminiJson<{ items: { id: string; label?: string; status: string; detail: string }[]; summary: string; top_fixes: string[] }>(
        `SOP:\n${sop}\n\nCLIENT: ${article.client.name}${article.client.primaryCity ? ` (local client, city: ${article.client.primaryCity})` : ""}\nCLIENT BRAIN:\n${article.client.brain?.rules || "(no rules learned yet)"}\n\nCLIENT'S LAST 3 BLOGS:\n${last3}\n\nITEMS TO JUDGE:\n${wanted.map(([id, label]) => `- ${id}: ${label}`).join("\n")}\n\nARTICLE\nTitle: ${article.metaTitle}\nFocus keyword: ${article.focusKeyword}\nMeta description: ${article.metaDescription ?? ""}\n\n${plain}`,
        { system: SYSTEM },
      );
      const labels = new Map<string, string>(wanted.map(([id, label]) => [id, label]));
      const items: CheckItem[] = (out.items ?? [])
        .filter((i) => labels.has(i.id))
        .map((i) => ({ id: `ai_${i.id}`, group: "AI review", label: labels.get(i.id)!, status: (["pass", "warn", "fail"].includes(i.status) ? i.status : "warn") as CheckItem["status"], detail: i.detail || "" }));
      const v = { pass: 1, warn: 0.5, fail: 0 };
      report.aiScore = items.length ? Math.round((items.reduce((n, i) => n + v[i.status], 0) / items.length) * 100) : undefined;
      report.ai = { items, summary: out.summary ?? "", topFixes: out.top_fixes ?? [] };
      report.aiHash = hash;
    } catch (e) {
      report.aiError = e instanceof Error ? e.message : String(e);
      if (prev?.ai && prev.aiHash === hash) { report.ai = prev.ai; report.aiScore = prev.aiScore; report.aiHash = hash; }
    }
  } else if (prev?.ai && prev.aiHash === hash) {
    // Keep the last AI review if the article hasn't changed since.
    report.ai = prev.ai;
    report.aiScore = prev.aiScore;
    report.aiHash = hash;
  }

  const score = report.aiScore != null ? Math.round(report.ruleScore * 0.7 + report.aiScore * 0.3) : report.ruleScore;
  await db.article.update({
    where: { id: articleId },
    data: {
      qualityScore: score,
      qualityReport: report as unknown as Prisma.InputJsonValue,
      qualityCheckedAt: new Date(),
      ...(opts.ai && report.ai && !report.aiError ? { aiReviewedAt: new Date() } : {}),
    },
  });
  return { score, report };
}
