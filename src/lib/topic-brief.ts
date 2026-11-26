/**
 * Turns a raw topic (keyword + a one-line idea from n8n WF1) into a researched brief, the way a senior strategist would:
 * Google Search for what's current (launch dates, changes, official docs), the SERP and People Also Ask for what readers
 * want, and the client's own services, then a specific H1, SEO title, meta description, direction and outline.
 */
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { geminiConfigured, geminiGrounded, geminiJson } from "./gemini";
import { brandContext } from "./brand-profile";
import { getResearch } from "./research";
import { dataforseoConfigured } from "./dataforseo";
import { yearRule } from "./year";
import { pickArea } from "./local-area";

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
- Every blog must have its own shape. Pick the format that suits THIS topic (step-by-step guide, cost breakdown, comparison, checklist, myths vs facts, signs/symptoms, decision guide, case scenario, seasonal plan) and make the outline clearly different from the client's recent outlines listed below: different first section, different order and different kinds of sections. Don't fall back on "What is X / Benefits / How to choose / FAQ".
- Local clients: write for the TARGET AREA given below (its neighbourhoods, climate, rules, typical homes or businesses). Put the target area in the H1 and SEO title naturally; the company can be described as based in its main city.
Return ONLY JSON in a code block: {"h1":"...","seo_title":"...","meta_description":"...","direction":"...","outline":[{"heading":"...","notes":"..."}],"facts":[{"fact":"...","source":"<url>"}]}`;

export async function briefTopic(topicId: string) {
  if (!geminiConfigured()) throw new Error("GEMINI_API_KEY is not set in Vercel");
  const topic = await db.topic.findUniqueOrThrow({ where: { id: topicId }, include: { client: { select: { id: true, name: true, businessType: true, primaryCity: true, serviceAreaCities: true, targetCountry: true, siteUrl: true, ctaText: true, linkPool: true } } } });
  await db.topic.update({ where: { id: topicId }, data: { briefingAt: new Date(), briefError: null } });
  try {
    const c = topic.client;
    const research = dataforseoConfigured() && topic.keyword ? await getResearch(c.id, topic.keyword).catch(() => null) : null;
    const services = c.linkPool.filter((u) => /servic|solution|product/i.test(u)).slice(0, 25);
    // Local clients: which city or service area this blog targets (named in the keyword, else spread across the areas).
    const area = topic.targetCity ?? (c.primaryCity || c.serviceAreaCities.length ? await pickArea(c.id, topic.keyword, topic.title).catch(() => null) : null);
    const recentOutlines = await recentOutlinesOf(c.id, topic.id);
    const prompt = `KEYWORD: ${topic.keyword}
ROUGH IDEA FROM THE TOPIC GENERATOR (improve it, don't just reword it): ${topic.title}${topic.angle ? ` — ${topic.angle}` : ""}
TODAY: ${new Date().toISOString().slice(0, 10)}

CLIENT: ${c.name}${c.businessType ? ` (${c.businessType})` : ""}, ${[c.primaryCity, c.targetCountry].filter(Boolean).join(", ") || "location not set"}, site ${c.siteUrl}${c.ctaText ? `\nCTA: ${c.ctaText}` : ""}
${area ? `TARGET AREA FOR THIS BLOG: ${area}${c.primaryCity && area !== c.primaryCity ? ` (the company is based in ${c.primaryCity} and serves ${area})` : ""}\n` : ""}${recentOutlines ? `CLIENT'S RECENT OUTLINES (use a different structure):\n${recentOutlines}\n` : ""}${services.length ? `CLIENT SERVICE PAGES:\n${services.map((u) => `- ${u}`).join("\n")}\n` : ""}BRAND NOTES: ${((await brandContext(c.id).catch(() => "")) || "(none)").slice(0, 1500)}
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
        targetCity: area,
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
export function briefText(t: { title: string; angle: string | null; seoTitle: string | null; metaDescription: string | null; outline: unknown; targetCity?: string | null }) {
  const outline = (t.outline as OutlineItem[] | null) ?? [];
  if (!outline.length && !t.seoTitle && !t.targetCity) return "";
  return [
    `\nARTICLE BRIEF (approved by the team: follow it; the H1, SEO title and meta description are final)`,
    t.targetCity && `- TARGET AREA: ${t.targetCity}. This blog targets ${t.targetCity}: use it (not the client's main city) in the intro, at least one H2, the conclusion and the CTA, with local details for ${t.targetCity}.`,
    `- H1: ${t.title}`,
    t.seoTitle && `- SEO title: ${t.seoTitle}`,
    t.metaDescription && `- Meta description: ${t.metaDescription}`,
    t.angle && `- Direction: ${t.angle}`,
    outline.length && `- Outline (H2s in this order, with what goes in each):\n${outline.map((o, i) => `  ${i + 1}. ${o.heading}${o.notes ? ` — ${o.notes}` : ""}`).join("\n")}`,
  ].filter(Boolean).join("\n");
}

/** H2s of the client's last few briefs and blogs, so a new outline can avoid the same shape. */
async function recentOutlinesOf(clientId: string, exceptTopicId: string) {
  const [topics, arts] = await Promise.all([
    db.topic.findMany({ where: { clientId, id: { not: exceptTopicId }, briefAt: { not: null } }, orderBy: { briefAt: "desc" }, take: 5, select: { title: true, outline: true } }),
    db.article.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 3, select: { metaTitle: true, bodyHtml: true } }),
  ]);
  const lines = [
    ...topics.map((t) => `- ${t.title}: ${((t.outline as OutlineItem[] | null) ?? []).map((o) => o.heading).join(" | ")}`),
    ...arts.map((a) => `- ${a.metaTitle}: ${[...a.bodyHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).slice(0, 10).join(" | ")}`),
  ];
  return lines.join("\n");
}

/** Rewrites a topic's outline the way the team asks ("make it a cost breakdown", "fewer sections"), different from recent ones. */
export async function reshapeOutline(topicId: string, instruction: string) {
  if (!geminiConfigured()) throw new Error("GEMINI_API_KEY is not set in Vercel");
  const t = await db.topic.findUniqueOrThrow({ where: { id: topicId }, include: { client: { select: { id: true, name: true, businessType: true, primaryCity: true } } } });
  const recent = await recentOutlinesOf(t.clientId, t.id);
  const current = ((t.outline as OutlineItem[] | null) ?? []).map((o, i) => `${i + 1}. ${o.heading}${o.notes ? ` — ${o.notes}` : ""}`).join("\n") || "(no outline yet)";
  const out = await geminiJson<{ h1?: string; seo_title?: string; outline?: OutlineItem[] }>(
    `CLIENT: ${t.client.name}${t.client.businessType ? ` (${t.client.businessType})` : ""}${t.targetCity ? `\nTARGET AREA: ${t.targetCity}` : t.client.primaryCity ? `\nCITY: ${t.client.primaryCity}` : ""}
FOCUS KEYWORD: ${t.keyword}
H1: ${t.title}
SEO TITLE: ${t.seoTitle ?? ""}
DIRECTION: ${t.angle ?? ""}

CURRENT OUTLINE:
${current}

CLIENT'S RECENT OUTLINES (the new one must not look like these):
${recent || "(none)"}

WHAT THE TEAM WANTS: ${instruction.trim() || "A fresh structure that suits this topic and is clearly different from the recent outlines."}`,
    {
      system: `You restructure the outline of one blog for an SEO agency, following the team's instruction exactly.
Keep the topic, focus keyword and facts from the current notes. Change the structure: the kinds of sections, their order and the opening section.
5–8 H2s, each with short notes on what goes in it. Answer the main question in the first section. Put the focus keyword in 2–3 H2s naturally. End with an FAQ and a CTA.
If the H1 or SEO title promises a number ("7 Tips") and the new outline has a different number of points, return an updated h1 and seo_title with the right number; otherwise return them unchanged.
${yearRule().text}
Return JSON: {"h1":"...","seo_title":"...","outline":[{"heading":"...","notes":"..."}]}`,
      temperature: 0.8,
      timeoutMs: 60_000,
    },
  );
  const outline = (out.outline ?? []).filter((o) => o?.heading).slice(0, 10).map((o) => ({ heading: String(o.heading).trim(), notes: String(o.notes ?? "").trim() }));
  if (outline.length < 3) throw new Error("The AI didn't return a usable outline. Try again.");
  return db.topic.update({
    where: { id: topicId },
    data: {
      outline: outline as unknown as Prisma.InputJsonValue,
      ...(out.h1?.trim() ? { title: out.h1.trim().slice(0, 200) } : {}),
      ...(out.seo_title?.trim() ? { seoTitle: out.seo_title.trim().slice(0, 80) } : {}),
      status: "GENERATED",
    },
  });
}
