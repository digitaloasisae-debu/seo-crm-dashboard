import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { checkN8nAuth } from "@/lib/n8n";
import { normalizeKeyword } from "@/lib/utils";
import { ensureSlots } from "@/lib/posting";

const Body = z.object({
  topics: z
    .array(
      z.object({
        keyword: z.string().min(1),
        topic: z.string().min(1),
        category: z.string().optional().default(""),
        angle: z.string().optional().default(""),
        secondary_keywords: z.union([z.array(z.string()), z.string()]).optional(),
      }),
    )
    .min(1),
});

const GENERIC = new Set("the and for with your you how what why when where who best top guide tips ways step steps quick easy 2025 2026 2027 from that this into near".split(" "));

// POST /api/n8n/clients/{id}/topics
// (replaces "Append to Topic Queue" + "Mark Keywords Used" in WF1, in one call)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkN8nAuth(req);
  if (denied) return denied;
  const { id: clientId } = await params;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // The topic writer sometimes shortens the keyword (e.g. "rank" instead of "how to rank on google in dubai").
  // Then match the topic to the unused approved keyword it shares the most words with, so the blog targets the real search.
  const unused = await db.keyword.findMany({ where: { clientId, status: "APPROVED", used: false }, select: { keyword: true, keywordNorm: true } });
  const taken = new Set(parsed.data.topics.map((t) => normalizeKeyword(t.keyword)));
  const words = (x: string) => new Set(x.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !GENERIC.has(w)).map((w) => w.replace(/s$/, "")));
  const known = new Set((await db.keyword.findMany({ where: { clientId, keywordNorm: { in: [...taken] } }, select: { keywordNorm: true } })).map((k) => k.keywordNorm));
  for (const t of parsed.data.topics) {
    if (known.has(normalizeKeyword(t.keyword))) continue;
    const have = words(`${t.keyword} ${t.topic}`);
    const best = unused
      .filter((k) => !taken.has(k.keywordNorm))
      .map((k) => { const kw = [...words(k.keyword)]; const hit = kw.filter((w) => have.has(w)).length; return { k, hit, share: kw.length ? hit / kw.length : 0 }; })
      .filter((m) => m.hit >= 2 || m.share >= 0.5)
      .sort((a, b) => b.hit - a.hit || b.share - a.share)[0];
    if (best && best.hit > words(t.keyword).size - 1) {
      taken.add(best.k.keywordNorm);
      t.keyword = best.k.keyword;
    }
  }

  const created = await db.$transaction(async (tx) => {
    const out = [];
    for (const t of parsed.data.topics) {
      const kw = await tx.keyword.findUnique({ where: { clientId_keywordNorm: { clientId, keywordNorm: normalizeKeyword(t.keyword) } } });
      const secondary = Array.isArray(t.secondary_keywords)
        ? t.secondary_keywords
        : (t.secondary_keywords ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const topic = await tx.topic.create({
        data: { clientId, keywordId: kw?.id, keyword: t.keyword, title: t.topic, category: t.category, angle: t.angle, secondaryKeywords: secondary },
      });
      if (kw && !kw.used) await tx.keyword.update({ where: { id: kw.id }, data: { used: true, usedAt: new Date() } });
      out.push(topic);
    }
    await logActivity({ actorTag: "n8n", clientId, action: "topic.generate", entity: "client", entityId: clientId, after: { count: out.length } }, tx);
    return out;
  });

  // Topics arrive monthly, so make sure this month's and next month's posting dates exist.
  const now = new Date();
  await ensureSlots(clientId, now);
  await ensureSlots(clientId, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));

  return NextResponse.json({ created: created.map((t) => ({ id: t.id, keyword: t.keyword, topic: t.title })) });
}
