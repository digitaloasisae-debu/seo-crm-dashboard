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
- If the rulebook has a "## What ranks for this client" section, keep it exactly as it is at the end (it comes from Google data, not notes).
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
${opts.all ? `(rebuild from scratch)${brain?.rules.match(/## What ranks for this client[\s\S]*?(?=\n## |$)/)?.[0] ? `\n\n${brain.rules.match(/## What ranks for this client[\s\S]*?(?=\n## |$)/)![0]}` : ""}` : brain?.rules || "(empty)"}

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

const RANK_SYSTEM = `You maintain a per-client rulebook for an AI blog writer. You now get REAL Google results (Search Console) for this client's published articles: the best and worst performers.
Find patterns that separate winners from losers (title style, length, structure, topics/intent, headings, local angle, FAQ use, etc.).
Update ONLY the section "## What ranks for this client" (create it if missing; max 8 bullets, each citing the evidence briefly, e.g. "Question titles rank better (avg #6 vs #19)").
Keep every other section exactly as it is. Only state patterns the data supports; with weak evidence say "early signal".
Return JSON: {"rules": "<full markdown rulebook>", "changes": ["<one line per bullet added/changed/removed>"]}`;

/** Teach the brain from Search Console: compare the client's best and worst ranking articles. */
export async function learnFromRankings(clientId: string) {
  const { articleRanks, matchArticleSlug } = await import("./gsc-report");
  const ranks = await articleRanks(clientId);
  const articles = await db.article.findMany({
    where: { clientId, status: "PUSHED_DRAFT" },
    select: { slug: true, metaTitle: true, focusKeyword: true, bodyHtml: true, qualityScore: true },
  });
  const rows = articles
    .map((a) => { const m = matchArticleSlug(a, ranks.keys()); return { a, r: m ? ranks.get(m) : undefined }; })
    .filter((x): x is { a: (typeof articles)[number]; r: NonNullable<typeof x.r> } => !!x.r && x.r.impressions >= 20)
    .sort((x, y) => x.r.position - y.r.position);
  if (rows.length < 4) return { changes: [] as string[], skipped: true, reason: `Only ${rows.length} published article${rows.length === 1 ? " has" : "s have"} enough Google data (need 4)` };
  const third = Math.max(2, Math.floor(rows.length / 3));
  const describe = ({ a, r }: (typeof rows)[number]) => {
    const text = a.bodyHtml.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
    const words = text.split(/\s+/).filter(Boolean).length;
    const h2 = [...a.bodyHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).slice(0, 8);
    return `- "${a.metaTitle}" | keyword: ${a.focusKeyword} | avg position ${r.position.toFixed(1)}${r.prevPosition != null ? ` (was ${r.prevPosition.toFixed(1)})` : ""} | ${r.clicks} clicks, ${r.impressions} impressions, CTR ${((r.clicks / r.impressions) * 100).toFixed(1)}% | ${words} words | FAQ: ${/faq|frequently asked/i.test(text) ? "yes" : "no"} | SOP score ${a.qualityScore ?? "?"}\n  H2s: ${h2.join(" / ")}`;
  };
  const brain = await db.clientBrain.findUnique({ where: { clientId } });
  const prompt = `CURRENT RULEBOOK:\n${brain?.rules || "(empty)"}\n\nBEST PERFORMERS (last 4 weeks):\n${rows.slice(0, third).map(describe).join("\n")}\n\nWORST PERFORMERS:\n${rows.slice(-third).map(describe).join("\n")}`;
  const out = await geminiJson<{ rules: string; changes?: string[] }>(prompt, { system: RANK_SYSTEM });
  if (!out?.rules) throw new Error("Empty rulebook from Gemini");
  await db.clientBrain.upsert({
    where: { clientId },
    create: { clientId, rules: out.rules.trim(), version: 1, lastLearnedAt: new Date(), rankingsLearnedAt: new Date() },
    update: { rules: out.rules.trim(), version: { increment: 1 }, lastLearnedAt: new Date(), rankingsLearnedAt: new Date(), lastError: null },
  });
  return { changes: out.changes ?? [], skipped: false, reason: "" };
}
