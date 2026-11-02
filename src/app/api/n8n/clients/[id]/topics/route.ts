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

// POST /api/n8n/clients/{id}/topics
// (replaces "Append to Topic Queue" + "Mark Keywords Used" in WF1, in one call)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkN8nAuth(req);
  if (denied) return denied;
  const { id: clientId } = await params;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

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
