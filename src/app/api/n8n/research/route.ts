import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { checkN8nAuth } from "@/lib/n8n";
import { getResearch, headingPlan, planBrief, researchBrief, topicPlan } from "@/lib/research";
import { getSop } from "@/lib/sop";
import { linkIdeas } from "@/lib/keyword-usage";

export const maxDuration = 120;

// GET /api/n8n/research?topic_id={id}[&refresh=1]
// SOP Step 1 for one topic: competitors, People Also Ask, secondary keywords, plus the SOP,
// the client's last 3 blogs and internal link ideas. Never fails the workflow: on a research error
// it returns empty research with "research_error" so n8n can carry on with manual competitors.
export async function GET(req: NextRequest) {
  const denied = checkN8nAuth(req);
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const topic = await db.topic.findUnique({ where: { id: sp.get("topic_id") ?? "" }, select: { id: true, clientId: true, keyword: true, title: true, angle: true } });
  if (!topic) return NextResponse.json({ error: "Topic not found" }, { status: 404 });

  const [sop, recent, links, research] = await Promise.all([
    getSop(),
    db.article.findMany({ where: { clientId: topic.clientId }, orderBy: { createdAt: "desc" }, take: 3, select: { metaTitle: true, bodyHtml: true } }),
    linkIdeas(topic.clientId, `${topic.keyword} ${topic.title}`, { limit: 8 }).catch(() => []),
    getResearch(topic.clientId, topic.keyword || topic.title, { refresh: sp.get("refresh") === "1" }).then((r) => ({ r, error: null as string | null })).catch((e) => ({ r: null, error: e instanceof Error ? e.message : String(e) })),
  ]);
  const r = research.r;
  // Which PAA questions and competitor keywords fit THIS article (research is per keyword, shared by every topic on it).
  const plan = r ? await topicPlan(topic, r, { refresh: sp.get("refresh") === "1" }).catch(() => null) : null;
  // The intro links the service page for this topic: the best-matching page that isn't the home page or a general hub.
  const generic = (u: string) => { try { const segs = new URL(u).pathname.split("/").filter(Boolean); return segs.length === 0 || (segs.length === 1 && /^(services?|our-services|solutions|blog|about(-us)?|contact(-us)?|home)$/i.test(segs[0])); } catch { return true; } };
  const intro = links.filter((l) => !generic(l.url)).sort((a, b) => Number(/\/(services?|solutions?)\//i.test(b.url)) - Number(/\/(services?|solutions?)\//i.test(a.url)) || b.score - a.score)[0] ?? null;
  const introLine = intro ? `\nINTRO LINK: the first paragraph links to ${intro.url} (the service page for this topic), with a 2–3 word anchor. Never link the general services page or the home page in the intro.` : "";
  const recentBlogs = recent.map((a) => {
    const html = a.bodyHtml.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
    return {
      title: a.metaTitle,
      opening: (html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "").replace(/<[^>]+>/g, "").slice(0, 200),
      headings: [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).slice(0, 10),
    };
  });
  return NextResponse.json({
    topic_id: topic.id,
    keyword: topic.keyword,
    location: r?.location ?? null,
    competitors: (r?.competitors ?? []).map((c) => ({ url: c.url, title: c.title, position: c.position, words: c.words, review: c.review ?? "", h2: c.h2, h3: c.h3, ranks_for: c.keywords.slice(0, 15).map((k) => k.keyword) })),
    competitor_gaps: r?.gaps ?? [],
    heading_plan: plan ?? (r ? (r.plan ?? headingPlan(r.paa, r.secondaryKeywords.map((k) => k.keyword))) : null),
    intro_link: intro ? { url: intro.url, anchor: intro.anchor } : null,
    competitor_urls: (r?.competitors ?? []).map((c) => c.url),
    secondary_keywords: (r?.secondaryKeywords ?? []).map((k) => k.keyword),
    people_also_ask: r?.paa ?? [],
    related_searches: r?.relatedSearches ?? [],
    research_brief: r ? researchBrief(r) + (plan ? planBrief(plan) : "") + introLine : introLine.trim(),
    research_error: research.error,
    internal_link_suggestions: links.map((l) => ({ url: l.url, anchor: l.anchor, title: l.title })),
    recent_blogs: recentBlogs,
    sop,
  });
}
