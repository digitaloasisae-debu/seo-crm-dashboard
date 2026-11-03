/** Runs the SOP checker on an article: rule checks always, plus a Gemini review when asked. */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { checkArticle, type CheckItem } from "./sop-check";
import { geminiConfigured, geminiJson } from "./gemini";
import { getSop } from "./sop";

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
Measurable items (word count, link counts, meta lengths, keyword placement, readability) are already checked by code; do NOT repeat them.
Judge ONLY the qualitative items listed below, each as "pass", "warn" or "fail" with a one-sentence reason quoting the article where useful.
Return JSON: {"items":[{"id":"...","label":"...","status":"pass|warn|fail","detail":"..."}],"summary":"<2 sentences>","top_fixes":["<max 5 specific fixes, most important first>"]}`;

const AI_ITEMS = [
  ["intent", "Matches the search intent of the keyword"],
  ["value", "Original, actionable and solves the reader's problem"],
  ["secondary_kw", "H2/H3s use related (LSI) keywords in a logical order"],
  ["snippets", "Optimised for featured snippets (lists, tables, Q&A)"],
  ["faq_quality", "FAQs are distinct and relevant (People-Also-Ask style)"],
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
  const rule = checkArticle(article, article.client);
  const report: QualityReport = { ruleScore: rule.score, wordCount: rule.wordCount, local: rule.local, items: rule.items };
  const prev = article.qualityReport as unknown as QualityReport | null;
  const hash = createHash("sha1").update(`${article.metaTitle}|${article.metaDescription}|${article.focusKeyword}|${article.bodyHtml}`).digest("hex");

  if (opts.ai && geminiConfigured()) {
    try {
      const wanted = [...AI_ITEMS, ...(rule.local ? LOCAL_ITEMS : [])];
      const sop = await getSop();
      const plain = article.bodyHtml.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<\/(p|h[1-6]|li|tr)>/gi, "\n").replace(/<h([1-6])[^>]*>/gi, (_m, l) => `${"#".repeat(Number(l))} `).replace(/<li[^>]*>/gi, "- ").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").slice(0, 30000);
      const out = await geminiJson<{ items: { id: string; label?: string; status: string; detail: string }[]; summary: string; top_fixes: string[] }>(
        `SOP:\n${sop}\n\nCLIENT: ${article.client.name}${article.client.primaryCity ? ` (local client, city: ${article.client.primaryCity})` : ""}\nCLIENT BRAIN:\n${article.client.brain?.rules || "(no rules learned yet)"}\n\nITEMS TO JUDGE:\n${wanted.map(([id, label]) => `- ${id}: ${label}`).join("\n")}\n\nARTICLE\nTitle: ${article.metaTitle}\nFocus keyword: ${article.focusKeyword}\nMeta description: ${article.metaDescription ?? ""}\n\n${plain}`,
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
