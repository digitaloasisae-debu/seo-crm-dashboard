/**
 * The per-client learning agent. Notes from the team (and later, ranking results) are distilled
 * into a short rulebook for that client. n8n receives it with every article job (field "brand_brain").
 */
import { db } from "./db";
import { geminiJson } from "./gemini";

export async function getBrain(clientId: string) {
  return db.clientBrain.findUnique({ where: { clientId } });
}

const SYSTEM = `You maintain a per-client "brain": a concise rulebook an AI blog writer must follow for ONE client.
You receive the current rulebook and new feedback notes from the agency team about articles written for this client.
Update the rulebook so future articles avoid what the team disliked and repeat what they liked.
Rules:
- Output markdown with these sections (omit empty ones): "## Voice & tone", "## Content & structure", "## Titles & headings", "## Images", "## Facts about the business", "## Never do", "## Always do".
- Each rule is one short, specific, actionable bullet. Generalise from the note (e.g. "too salesy intro" -> "Open with the reader's problem, not a sales pitch").
- Keep existing rules unless a new note contradicts them (newest wins). Merge duplicates. Max 40 bullets total.
- Ignore notes that are only about a single typo or a one-off factual fix, unless they reveal a pattern.
- Never invent preferences that the notes don't support.
Return JSON: {"rules": "<markdown>", "changes": ["<one line per rule added/changed/removed>"]}`;

/** Fold all not-yet-learned notes for this client into its brain. */
export async function learn(clientId: string, opts: { all?: boolean } = {}) {
  const [client, brain, notes] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, businessType: true, primaryCity: true, brandVoiceAvoid: true } }),
    db.clientBrain.findUnique({ where: { clientId } }),
    db.articleNote.findMany({
      where: { clientId, ...(opts.all ? {} : { learnedAt: null }) },
      include: { article: { select: { metaTitle: true } }, author: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 80,
    }),
  ]);
  if (notes.length === 0) return { changes: [] as string[], skipped: true };
  const prompt = `Client: ${client.name}${client.businessType ? ` (${client.businessType})` : ""}${client.primaryCity ? `, ${client.primaryCity}` : ""}
Brand voice to avoid (from onboarding): ${client.brandVoiceAvoid || "none given"}

CURRENT RULEBOOK:
${opts.all ? "(rebuild from scratch)" : brain?.rules || "(empty)"}

NEW NOTES (oldest first):
${notes.map((n) => `- [${n.kind.toLowerCase()}] on "${n.article.metaTitle}"${n.quote ? ` about: "${n.quote.slice(0, 300)}"` : ""}: ${n.body}`).join("\n")}`;
  try {
    const out = await geminiJson<{ rules: string; changes?: string[] }>(prompt, { system: SYSTEM });
    if (!out?.rules) throw new Error("Empty rulebook from Gemini");
    await db.$transaction([
      db.clientBrain.upsert({
        where: { clientId },
        create: { clientId, rules: out.rules.trim(), version: 1, lastLearnedAt: new Date() },
        update: { rules: out.rules.trim(), version: { increment: 1 }, lastLearnedAt: new Date(), lastError: null },
      }),
      db.articleNote.updateMany({ where: { id: { in: notes.map((n) => n.id) } }, data: { learnedAt: new Date() } }),
    ]);
    return { changes: out.changes ?? [], skipped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.clientBrain.upsert({ where: { clientId }, create: { clientId, lastError: msg }, update: { lastError: msg } });
    throw e;
  }
}
