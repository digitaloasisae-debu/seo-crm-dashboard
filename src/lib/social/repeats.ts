import { db } from "../db";

/**
 * Spotting repeated posts (Hamza, 2026-11-27: "many posts are the same content with different wording,
 * many even have the same wording"). Plain word overlap, no AI: cheap enough to run on every plan.
 */

const STOP = new Set(
  "a an the and or but if then so to of in on at by for with from into onto about as is are was were be been being it its this that these those you your yours we our us they their them he she his her i me my not no do does did can could will would should may might just more most less very too than also only own same such each every any all some what which who whom why how when where there here have has had get got gets make makes made".split(" "),
);

/** Content words of a text, lightly stemmed. NFKC turns the caption's bold/italic letters back into plain ones. */
export function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.normalize("NFKC").toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/#\S+/g, " ").split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(raw.replace(/(ing|ed|es|s)$/, "") || raw);
  }
  return out;
}

/** 0 (nothing shared) to 1 (same words). */
export function similarity(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return (2 * both) / (a.size + b.size);
}

/** Ideas at or above this count as the same post. */
export const IDEA_REPEAT = 0.5;
/** Whole captions share brand and service words, so they need more overlap to count as a repeat. */
export const CAPTION_REPEAT = 0.6;

/** The part of a caption that carries its message: everything before the link and hashtags. */
export function captionBody(caption: string) {
  return caption.split(/\n🌐 |\n\.\n/)[0] ?? caption;
}

type Item = { id: string; idea: string; caption?: string };

/**
 * Which of `items` repeat something earlier: an item in `kept` or an earlier item in `items`.
 * Returns id -> the earlier idea it repeats.
 */
export function findRepeats(items: Item[], kept: Item[] = []) {
  const seen = kept.map((k) => ({ idea: k.idea, w: words(k.idea), c: k.caption ? words(captionBody(k.caption)) : null }));
  const out = new Map<string, string>();
  for (const it of items) {
    const w = words(it.idea);
    const c = it.caption ? words(captionBody(it.caption)) : null;
    const hit = seen.find((s) => similarity(w, s.w) >= IDEA_REPEAT || (c && s.c && similarity(c, s.c) >= CAPTION_REPEAT));
    if (hit) out.set(it.id, hit.idea);
    else seen.push({ idea: it.idea, w, c });
  }
  return out;
}

/**
 * The posts of a month that wait for review and repeat another post of the account (approved or live
 * ones, other months of the last 120 days, or an earlier draft this month). Returns id -> repeated idea.
 */
export async function monthRepeats(projectId: string, month: string) {
  const sel = { id: true, idea: true, captionFacebook: true, captionInstagram: true, captionLinkedin: true } as const;
  const since = new Date(Date.now() - 120 * 864e5);
  const [kept, drafts] = await Promise.all([
    db.socialPost.findMany({ where: { projectId, status: { not: "REJECTED" }, OR: [{ month: { not: month }, createdAt: { gte: since } }, { month, status: { not: "DRAFT" } }] }, select: sel, orderBy: { scheduledAt: "asc" } }),
    db.socialPost.findMany({ where: { projectId, month, status: "DRAFT" }, select: sel, orderBy: { scheduledAt: "asc" } }),
  ]);
  const item = (x: (typeof kept)[number]) => ({ id: x.id, idea: x.idea, caption: x.captionFacebook || x.captionInstagram || x.captionLinkedin || undefined });
  return findRepeats(drafts.map(item), kept.map(item));
}
