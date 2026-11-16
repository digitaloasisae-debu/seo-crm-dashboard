/**
 * The caption layout Hamza asked for (2026-11-16), the same on every platform:
 *
 *   🎯 𝗕𝗼𝗹𝗱 𝘁𝗶𝘁𝗹𝗲
 *
 *   One or two short sentences.
 *
 *   𝘽𝙤𝙡𝙙 𝙞𝙩𝙖𝙡𝙞𝙘 𝙡𝙞𝙨𝙩 𝙩𝙞𝙩𝙡𝙚:
 *   ✅ point
 *   ✅ point
 *
 *   One line on how the brand helps.
 *
 *   🌐 https://service-page
 *   .
 *   .
 *   .
 *   #Hashtags
 *
 * Facebook, Instagram and LinkedIn have no bold, so the title and list title use Unicode bold letters.
 */

const shift = (s: string, upper: number, lower: number, digit?: number) =>
  [...s]
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(lower + c - 97);
      if (digit && c >= 48 && c <= 57) return String.fromCodePoint(digit + c - 48);
      return ch;
    })
    .join("");

/** Unicode sans-serif bold (𝗔𝗮𝟬). */
export const bold = (s: string) => shift(s, 0x1d5d4, 0x1d5ee, 0x1d7ec);
/** Unicode sans-serif bold italic (𝘼𝙖); digits stay bold. */
export const boldItalic = (s: string) => shift(s, 0x1d63c, 0x1d656, 0x1d7ec);

export type CaptionParts = {
  emoji?: string;
  title?: string;
  intro?: string;
  listTitle?: string;
  points?: { emoji?: string; text?: string }[];
  closing?: string;
  hashtags?: string[];
};

const line = (s: unknown) => String(s ?? "").replace(/—/g, ",").replace(/\s+/g, " ").trim();
const firstEmoji = (s: unknown) => (String(s ?? "").match(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/u)?.[0] ?? "");

/** "#amazon ads" / "AmazonAds" -> "#AmazonAds"; drops empty and duplicate tags. */
export function cleanTags(tags: unknown[], max: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const words = String(t ?? "").replace(/^#+/, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const tag = words.map((w) => (w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w)).join("");
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(`#${tag}`);
    if (out.length >= max) break;
  }
  return out;
}

/** The title line as it appears at the top of the caption (also used for the title choices). */
export const titleLine = (title: unknown, emoji?: unknown) => {
  const t = line(title);
  if (!t) return "";
  const e = firstEmoji(emoji);
  return `${e ? `${e} ` : ""}${bold(t)}`;
};

export function buildCaption(c: CaptionParts, o: { url: string; tags: number }) {
  const points = (c.points ?? []).map((p) => ({ e: firstEmoji(p?.emoji) || "✅", t: line(p?.text) })).filter((p) => p.t).slice(0, 5);
  const tags = cleanTags(c.hashtags ?? [], o.tags);
  const blocks = [
    titleLine(c.title, c.emoji),
    line(c.intro),
    points.length ? [line(c.listTitle) ? `${boldItalic(line(c.listTitle).replace(/:$/, ""))}:` : "", ...points.map((p) => `${p.e} ${p.t}`)].filter(Boolean).join("\n") : "",
    line(c.closing),
    o.url ? `🌐 ${o.url}` : "",
  ].filter(Boolean);
  let out = blocks.join("\n\n");
  if (tags.length) out += `\n.\n.\n.\n${tags.join(" ")}`;
  return out;
}

/** The service page for a card: the saved one, else the first link in the card's "Link" section. */
export function cardUrl(card: { url?: string | null; card?: string | null } | undefined, siteUrl: string) {
  if (card?.url) return card.url;
  const text = card?.card ?? "";
  const after = text.slice(Math.max(0, text.search(/\*\*Link\*\*/i)));
  const host = siteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "").toLowerCase();
  const found = (after.match(/https?:\/\/[^\s)\]>"']+/g) ?? []).find((u) => !host || u.toLowerCase().includes(host));
  return found ? found.replace(/[.,;]+$/, "") : "";
}
