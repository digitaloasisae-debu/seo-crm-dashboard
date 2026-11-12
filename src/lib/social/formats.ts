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
export type DesignData = { texts?: Record<string, string>; variant?: number; pic?: string };
export const designOf = (d: unknown): DesignData => (d && typeof d === "object" && !Array.isArray(d) ? (d as DesignData) : {});

/** The text a format shows when the AI hasn't written design text for it (e.g. after switching format). */
export function fallbackText(format: string, p: Pick<SocialPost, "headlineTop" | "headlineMain" | "headlineBottom" | "hooks" | "idea">) {
  const head = [p.headlineMain, p.headlineBottom].filter(Boolean).join(" ") || p.idea;
  if (format === "note") return p.hooks[0] || p.idea;
  if (format === "type") return [p.headlineTop, head].filter(Boolean).join("\n");
  return head;
}
