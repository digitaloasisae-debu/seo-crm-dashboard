/**
 * Turns a raw topic (keyword + a one-line idea from n8n WF1) into a researched brief, the way a senior strategist would:
 * Google Search for what's current (launch dates, changes, official docs), the SERP and People Also Ask for what readers
 * want, and the client's own services, then a specific H1, SEO title, meta description, direction and outline.
 */
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { geminiConfigured, geminiGrounded } from "./gemini";
import { brandContext } from "./brand-profile";
import { getResearch } from "./research";
import { dataforseoConfigured } from "./dataforseo";
import { yearRule } from "./year";

export type OutlineItem = { heading: string; notes: string };
export const BRIEF_STALE_MS = 5 * 60_000;

const SYSTEM = `You are the senior content strategist at an SEO agency. You turn a keyword and a rough topic idea into a brief a writer can follow.
First use Google Search to learn what the keyword really is TODAY: what it is, which product or category it belongs to (e.g. a Google Ads feature is about ads, not organic rankings), what changed recently, dates announced, official documentation, and what experts say.
Then write a brief that is specific, current and useful, not generic:
- The angle answers a real question the client's buyers have right now and gives them something to DO (a checklist, a test plan, a decision guide). Name the concrete parts (features, steps, settings) instead of vague promises.
- Never write generic angles like "what is X and how will it change search" or "a simple strategy to keep rankings high".
- Tie it to the client's location and services, so the CTA follows naturally.
- Only state facts you found in search results. If a date or number isn't confirmed, say "verify" instead of guessing.
- H1: clear and specific, may be a question plus what the reader gets (up to ~90 characters).
- SEO title: under 60 characters, focus keyword (or its core) in the first half, location if natural. Years in the H1, SEO title and meta follow the YEAR RULE.
- Meta description: 140–160 characters, says what the reader learns.
- Direction: 1–2 sentences on what the article explains and what plan it gives, and for whom.
- Outline: 5–8 H2 sections in order. For each, short notes on what goes in it (facts to include, steps, comparisons, cautions). Answer the main question in the first section within 50 words. End with an FAQ and a CTA that fits the client's service.
- If the title promises a number ("5 steps"), the outline has exactly that many numbered points.
Return ONLY JSON in a code block: {"h1":"...","seo_title":"...","meta_description":"...","direction":"...","outline":[{"heading":"...","notes":"..."}],"facts":[{"fact":"...","source":"<url>"}]}`;

export async function briefTopic(topicId: string) {
  if (!geminiConfigured()) throw new Error("GEMINI_API_KEY is not set in Vercel");
  const topic = await db.topic.findUniqueOrThrow({ where: { id: topicId }, include: { client: { select: { id: true, name: true, businessType: true, primaryCity: true, targetCountry: true, siteUrl: true, ctaText: true, linkPool: true } } } });
  await db.topic.update({ where: { id: topicId }, data: { briefingAt: new Date(), briefError: null } });
  try {
    const c = topic.client;
    const research = dataforseoConfigured() && topic.keyword ? await getResearch(c.id, topic.keyword).catch(() => null) : null;
    const services = c.linkPool.filter((u) => /servic|solution|product/i.test(u)).slice(0, 25);
    const prompt = `KEYWORD: ${topic.keyword}
ROUGH IDEA FROM THE TOPIC GENERATOR (improve it, don't just reword it): ${topic.title}${topic.angle ? ` — ${topic.angle}` : ""}
TODAY: ${new Date().toISOString().slice(0, 10)}

CLIENT: ${c.name}${c.businessType ? ` (${c.businessType})` : ""}, ${[c.primaryCity, c.targetCountry].filter(Boolean).join(", ") || "location not set"}, site ${c.siteUrl}${c.ctaText ? `\nCTA: ${c.ctaText}` : ""}
${services.length ? `CLIENT SERVICE PAGES:\n${services.map((u) => `- ${u}`).join("\n")}\n` : ""}BRAND NOTES: ${((await brandContext(c.id).catch(() => "")) || "(none)").slice(0, 1500)}
${research ? `
GOOGLE TOP RESULTS FOR THE KEYWORD (${research.location}):
${research.competitors.map((x) => `- ${x.title} (${x.url})${x.h2.length ? `: ${x.h2.slice(0, 8).join(" | ")}` : ""}`).join("\n") || "(none read)"}
PEOPLE ALSO ASK: ${research.paa.join(" | ") || "(none)"}
${research.gaps?.length ? `WHAT THE TOP RESULTS MISS: ${research.gaps.join(" | ")}` : ""}` : ""}`;
    const { data, sources } = await geminiGrounded<{ h1?: string; seo_title?: string; meta_description?: string; direction?: string; outline?: OutlineItem[]; facts?: { fact: string; source: string }[] }>(prompt, { system: `${SYSTEM}\n${yearRule().text}`, timeoutMs: 120_000 });
    const h1 = data.h1?.trim();
    if (!h1 || !data.outline?.length) throw new Error("The brief came back incomplete. Try again.");
    const outline = data.outline.filter((o) => o?.heading).slice(0, 10).map((o) => ({ heading: String(o.heading).trim(), notes: String(o.notes ?? "").trim() }));
    const factSources = (data.facts ?? []).filter((f) => /^https?:\/\//.test(f.source ?? "")).map((f) => ({ url: f.source, title: f.fact.slice(0, 120) }));
    await db.topic.update({
      where: { id: topicId },
      data: {
        title: h1.slice(0, 200),
        angle: data.direction?.trim() || topic.angle,
        seoTitle: data.seo_title?.trim().slice(0, 80) || null,
        metaDescription: data.meta_description?.trim().slice(0, 200) || null,
        outline: outline as unknown as Prisma.InputJsonValue,
        briefSources: [...sources, ...factSources.filter((f) => !sources.some((s) => s.url === f.url))].slice(0, 15) as unknown as Prisma.InputJsonValue,
        briefAt: new Date(),
        briefingAt: null,
        briefError: null,
      },
    });
  } catch (e) {
    await db.topic.update({ where: { id: topicId }, data: { briefingAt: null, briefError: e instanceof Error ? e.message : String(e) } });
    throw e;
  }
}

/** Briefs several topics, a few at a time (each takes 30–90 seconds). */
export async function briefTopics(ids: string[], concurrency = 3) {
  const queue = [...ids];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) await briefTopic(id).catch((e) => console.error("topic_brief_failed", id, e));
  }));
}

/** The brief as plain text for the writer (n8n WF2 and the AI rewrite). */
export function briefText(t: { title: string; angle: string | null; seoTitle: string | null; metaDescription: string | null; outline: unknown }) {
  const outline = (t.outline as OutlineItem[] | null) ?? [];
  if (!outline.length && !t.seoTitle) return "";
  return [
    `\nARTICLE BRIEF (approved by the team: follow it; the H1, SEO title and meta description are final)`,
    `- H1: ${t.title}`,
    t.seoTitle && `- SEO title: ${t.seoTitle}`,
    t.metaDescription && `- Meta description: ${t.metaDescription}`,
    t.angle && `- Direction: ${t.angle}`,
    outline.length && `- Outline (H2s in this order, with what goes in each):\n${outline.map((o, i) => `  ${i + 1}. ${o.heading}${o.notes ? ` — ${o.notes}` : ""}`).join("\n")}`,
  ].filter(Boolean).join("\n");
}
