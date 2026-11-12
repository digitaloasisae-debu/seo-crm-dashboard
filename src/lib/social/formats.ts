/** Image formats of social posts (no server code here, the post card uses it too). */
import type { SocialPost } from "@prisma/client";

export const FORMATS: [string, string][] = [
  ["concept", "Concept"],
  ["photo", "Photo"],
  ["type", "Big type"],
  ["note", "Note"],
  ["list", "List"],
  ["versus", "Versus"],
];
export const TEXT_FORMATS = ["type", "note", "list", "versus"];
export const isFormat = (f: string) => FORMATS.some(([k]) => k === f);
/** Formats whose picture is a photo or AI visual with a short headline (edited in the headline fields). */
export const PICTURE_FORMATS = ["concept", "photo"];
/** Older posts used banner/split/statement. */
export function formatOf(layout: string) {
  if (isFormat(layout)) return layout;
  return layout === "statement" ? "type" : "photo";
}

/** How the "image text" box is read for each format (also shown as the placeholder). */
export const FORMAT_HELP: Record<string, string> = {
  type: "First line: small text on top (optional). Then the big line. Put *stars* around words to highlight them.",
  note: "The note, exactly as it should read. Blank line = new paragraph. *Stars* highlight.",
  list: "First line: the title. Then one point per line (3 to 5).",
  versus: "Line 1: the title. Line 2: Left label | Right label. Then one row per line: left point | right point.",
};

/** design JSON on a post: the image text per format (so switching back keeps edits) and the look variant. */
/** pic = what the stored AI picture is ("concept" visual or "photo"), so switching formats never reuses the wrong one. */
/** slides = carousel slides after the cover; scenes = the words of the Reel, one line per beat. */
export type Slide = { title: string; body: string };
export type DesignData = { texts?: Record<string, string>; variant?: number; pic?: string; slides?: Slide[]; scenes?: string[]; end?: string };
export const designOf = (d: unknown): DesignData => (d && typeof d === "object" && !Array.isArray(d) ? (d as DesignData) : {});

/** The text a format shows when the AI hasn't written design text for it (e.g. after switching format). */
export function fallbackText(format: string, p: Pick<SocialPost, "headlineTop" | "headlineMain" | "headlineBottom" | "hooks" | "idea">) {
  const head = [p.headlineMain, p.headlineBottom].filter(Boolean).join(" ") || p.idea;
  if (format === "note") return p.hooks[0] || p.idea;
  if (format === "type") return [p.headlineTop, head].filter(Boolean).join("\n");
  return head;
}

/** What a post is published as. */
export const KINDS: [string, string][] = [
  ["static", "Image"],
  ["carousel", "Carousel"],
  ["video", "Reel"],
];
export const kindLabel = (k: string) => KINDS.find(([x]) => x === k)?.[1] ?? "Image";
/** Every week (Monday to Saturday, never Sunday): 1 carousel, 2 Reels, 2 images. */
export const WEEK_MIX: Record<string, number> = { carousel: 1, video: 2, static: 2 };
export const POSTS_PER_WEEK = Object.values(WEEK_MIX).reduce((a, b) => a + b, 0);

/** Content pillars and their share of the month (events come on top, on their real dates). */
export const PILLARS = [
  { key: "informative", label: "Informative", share: 0.4, hint: "Teach something useful about the service: a tip, a myth, a mistake, a how-to, a checklist. No selling." },
  { key: "soft", label: "Hidden promo", share: 0.2, hint: "Looks like a helpful or interesting post, but quietly shows why this business is the one to call (how we work, what we check, a problem we solve). No hard sell, no offer." },
  { key: "journey", label: "Brand / client journey", share: 0.2, hint: "A real story: how a client's situation changed step by step, or the brand's own story, values and way of working. Only facts from the service card, no invented clients or numbers." },
  { key: "promo", label: "Promotional", share: 0.2, hint: "A direct reason to choose this service now and a clear call to action. No invented discounts or prices." },
  { key: "event", label: "Holiday / event", share: 0, hint: "A national holiday, observance or big event on this date for the audience's country, tied naturally to the brand. Greeting first, light link to the service." },
] as const;
export const pillarOf = (k: string) => PILLARS.find((p) => p.key === k);

/** The Reel's words, one line per scene. */
export const scenesText = (d: DesignData) => (d.scenes ?? []).join("\n");
/** Carousel slides as text: one slide per block, "Title" on the first line, the text below. */
export const slidesText = (d: DesignData) => (d.slides ?? []).map((s) => [s.title, s.body].filter(Boolean).join("\n")).join("\n\n");
export function parseSlides(t: string): Slide[] {
  return t
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").map((x) => x.trim()).filter(Boolean))
    .filter((b) => b.length)
    .map((b) => ({ title: b[0].slice(0, 80), body: b.slice(1).join(" ").slice(0, 320) }))
    .slice(0, 8);
}
