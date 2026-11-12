/**
 * Social images. Five formats, all 1080x1350 JPEG (Instagram, Facebook and LinkedIn):
 *   photo  - a REAL photo from the project's library (or, only when asked, an AI photo) with the
 *            headline set in a solid block. No gradients.
 *   type   - a typographic poster: one sharp line, set big.
 *   note   - looks like a text post from the brand: avatar, name, a few honest lines.
 *   list   - a numbered checklist people save.
 *   versus - two columns: the usual way vs the better way.
 * Every post gets its own look (theme + font pairing) from a seed, so the feed does not repeat
 * one template. Text is always set in code, so it is spelled right.
 */
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { Client, SocialPost, SocialProject } from "@prisma/client";

export const W = 1080;
export const H = 1350;

import { designOf, fallbackText, formatOf } from "./formats";
export { FORMATS, FORMAT_HELP, PICTURE_FORMATS, TEXT_FORMATS, designOf, fallbackText, formatOf, isFormat, type DesignData } from "./formats";

// ---------- AI photo (only when asked) ----------

const imageModels = () => [process.env.GEMINI_IMAGE_MODEL, "gemini-3.1-flash-image", "gemini-2.5-flash-image"].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

/** A text-free AI photo, shot to look like a phone snap from a real workplace rather than stock. */
export async function drawPhoto(post: SocialPost, project: SocialProject & { client: Client }): Promise<Buffer> {
  const prompt = [
    `An unposed photo taken on a phone at ${project.client.name} (${project.client.businessType ?? "business"}, ${[project.client.primaryCity, project.client.targetCountry].filter(Boolean).join(", ")}).`,
    post.imageBrief || post.idea,
    "It must look like a real moment someone on the team snapped, not stock photography and not an ad: everyday clutter, ordinary people in ordinary clothes, mixed indoor light, slightly off-centre framing, natural grain, nothing too perfect or symmetrical. No glossy skin, no dramatic lighting, no bokeh, no lens flares, no glowing holograms, no floating icons, no people smiling at the camera, no suits and handshakes.",
    "ABSOLUTELY NO text, letters, numbers, logos, watermarks, signs or user interfaces anywhere. Screens and papers are turned away or out of focus.",
    project.imageStyle ? `Owner's notes: ${project.imageStyle}` : "",
    post.imageNote ? `Most important, the owner asked for this: ${post.imageNote}` : "",
    "Portrait 4:5.",
  ]
    .filter(Boolean)
    .join("\n");
  return generateImage(prompt);
}

const CONCEPT_STYLES = [
  "a clean, playful 3D render of real-looking materials with soft studio light and crisp shadows",
  "a cut-paper diorama made of layered coloured card, photographed with soft light",
  "a surreal still-life photograph of real everyday objects, arranged with wit, sharp and minimal",
  "a minimal claymation-style sculpture scene with tactile textures",
];

/**
 * The visual of a "concept" post: ONE striking visual metaphor on a flat background in the post's
 * theme colour, with the top third left empty for the headline. Not a fake photo of people.
 */
export async function drawConcept(post: SocialPost, project: SocialProject & { client: Client }): Promise<Buffer> {
  const bg = conceptTheme(post.id, project.client).bg;
  const style = CONCEPT_STYLES[hash(`${post.id}:style:${designOf(post.design).variant ?? 0}`) % CONCEPT_STYLES.length];
  const prompt = [
    `One bold, eye-catching visual for a social media post by ${project.client.name} (${project.client.businessType ?? "business"}). It must make people stop scrolling.`,
    `What the post is about: ${post.idea} (service: ${post.service}).`,
    `The visual: ${post.imageBrief || post.idea}`,
    "It must be obviously about that topic: show the real, recognisable subject of the post (the actual object, place or result a customer would recognise), not an abstract symbol. Someone seeing only this image should be able to guess the topic.",
    `Style: ${style}.`,
    `Background: one flat, solid colour, exactly ${bg}, edge to edge. No gradient, no vignette, no floor line, no scenery.`,
    "Composition: the subject sits in the lower two thirds and is large and centred; the top third of the frame is completely empty background (a headline goes there).",
    "Not stock photography: no people in offices, no handshakes, no faces looking at the camera, no glowing holograms, no floating icons. Any screen shows only simple shapes and colours.",
    "ABSOLUTELY NO text, letters, numbers, logos or symbols anywhere in the image.",
    project.imageStyle ? `Owner's notes: ${project.imageStyle}` : "",
    post.imageNote ? `Most important, the owner asked for this: ${post.imageNote}` : "",
    "Portrait 4:5.",
  ]
    .filter(Boolean)
    .join("\n");
  return generateImage(prompt);
}

/** A library photo, cropped to the post size. */
export function fitPhoto(data: Uint8Array | Buffer) {
  return sharp(Buffer.from(data)).rotate().resize(W, H, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
}

/** Ask Gemini for an image; returns a 1080x1350 JPEG. */
async function generateImage(prompt: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in Vercel");
  let lastErr = "";
  for (const model of imageModels()) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:5" } } }),
      signal: AbortSignal.timeout(150_000),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 404 || res.status === 400) {
      lastErr = j?.error?.message || `HTTP ${res.status}`;
      continue; // model name not available on this key: try the next one
    }
    if (!res.ok) {
      const msg = j?.error?.message || `HTTP ${res.status}`;
      if (res.status === 402 || /prepayment|credits/i.test(msg)) throw new Error("Gemini has no credit left. Top up in Google AI Studio.");
      throw new Error(`Image model: ${msg}`);
    }
    const parts: { inlineData?: { data: string }; inline_data?: { data: string } }[] = j?.candidates?.[0]?.content?.parts ?? [];
    const data = parts.find((x) => x.inlineData || x.inline_data);
    const b64 = data?.inlineData?.data ?? data?.inline_data?.data;
    if (!b64) throw new Error(`Image model returned no image (${j?.candidates?.[0]?.finishReason ?? j?.promptFeedback?.blockReason ?? "no reason given"})`);
    return sharp(Buffer.from(b64, "base64")).resize(W, H, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
  }
  throw new Error(`No image model available: ${lastErr}`);
}

// ---------- fonts ----------

const fontCache = new Map<string, Promise<ArrayBuffer | null>>();
function googleFont(family: string, weight: number, italic = false): Promise<ArrayBuffer | null> {
  const k = `${family}:${weight}:${italic}`;
  if (!fontCache.has(k)) {
    fontCache.set(
      k,
      (async () => {
        try {
          // Without a browser User-Agent Google serves TrueType, which the renderer needs.
          const axis = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
          const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:${axis}`, { signal: AbortSignal.timeout(10_000) })).text();
          const url = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
          if (!url) throw new Error("no ttf");
          return await (await fetch(url, { signal: AbortSignal.timeout(10_000) })).arrayBuffer();
        } catch {
          fontCache.delete(k); // try again next time
          return null;
        }
      })(),
    );
  }
  return fontCache.get(k)!;
}

/** Display fonts. `w` = average glyph width as a share of the font size (for fitting text). */
const DISPLAYS = [
  { family: "Instrument Serif", weight: 400, w: 0.43, lh: 1.02, ls: -1, italic: true },
  { family: "Archivo Black", weight: 400, w: 0.64, lh: 1.0, ls: -2, italic: false },
  { family: "Space Grotesk", weight: 700, w: 0.56, lh: 1.02, ls: -2, italic: false },
  { family: "DM Serif Display", weight: 400, w: 0.5, lh: 1.05, ls: -1, italic: true },
] as const;
type Display = (typeof DISPLAYS)[number];

// ---------- colour ----------

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
function hex(c: string | null | undefined, fallback: string) {
  const m = String(c ?? "").trim().match(HEX);
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return `#${h.toLowerCase()}`;
}
function lum(h: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function mix(h: string, toward: "#000000" | "#ffffff", amount: number) {
  const a = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(toward.slice(i, i + 2), 16));
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
/** Push `c` lighter or darker until it reads on `bg`. */
function readable(c: string, bg: string, min = 3) {
  let out = c;
  const toward = lum(bg) > 0.4 ? "#000000" : "#ffffff";
  for (let i = 0; i < 8 && contrast(out, bg) < min; i++) out = mix(out, toward, 0.2);
  return out;
}

type Theme = { bg: string; fg: string; muted: string; accent: string; line: string; dark: boolean };
function themes(c: Pick<Client, "brandPrimaryColor" | "brandSecondaryColor" | "brandAccentColor">): Theme[] {
  const primary = hex(c.brandPrimaryColor, "#1e3a8a");
  const accent = hex(c.brandAccentColor, "") || hex(c.brandSecondaryColor, "") || primary;
  const paper = "#f2eee6";
  const ink = "#151515";
  const brandBg = lum(primary) > 0.35 ? mix(primary, "#000000", 0.55) : primary;
  const brandFg = lum(brandBg) > 0.4 ? ink : "#ffffff";
  return [
    { bg: paper, fg: ink, muted: "#6f695e", accent: readable(primary, paper, 4), line: "#d9d3c7", dark: false },
    { bg: ink, fg: paper, muted: "#9b958a", accent: readable(accent, ink, 4), line: "#33312d", dark: true },
    { bg: brandBg, fg: brandFg, muted: brandFg === ink ? "#3d3d3d" : "#ffffffb3", accent: readable(accent !== primary ? accent : paper, brandBg, 3), line: brandFg === ink ? "#00000026" : "#ffffff33", dark: brandFg !== ink },
    { bg: "#ffffff", fg: "#111111", muted: "#71717a", accent: readable(accent, "#ffffff", 3.5), line: "#e4e4e7", dark: false },
  ];
}

// ---------- text helpers ----------

/** Rough line count of `text` at `size` in a box `width` wide. */
function lineCount(text: string, size: number, width: number, w: number) {
  const perLine = Math.max(4, Math.floor(width / (size * w)));
  let n = 0;
  for (const para of text.split("\n")) {
    let cur = 0;
    n += 1;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (cur && cur + 1 + word.length > perLine) {
        n += 1;
        cur = word.length;
      } else cur += (cur ? 1 : 0) + word.length;
    }
  }
  return n;
}
/** The biggest font size (step 2) at which `text` fits in the box. */
function fit(text: string, width: number, height: number, w: number, lh: number, min: number, max: number) {
  for (let s = max; s > min; s -= 2) if (lineCount(text, s, width, w) * s * lh <= height) return s;
  return min;
}

/**
 * Text with "*highlighted*" words. The renderer can't wrap mixed inline spans, so every word is its
 * own item in a wrapping row (one row per line of the text).
 */
function Rich({ text, accent, italic, size, lh }: { text: string; accent: string; italic?: boolean; size: number; lh: number }) {
  let on = false;
  const rows = text.split("\n").map((line) =>
    line.split(/\s+/).filter(Boolean).map((raw) => {
      const start = raw.startsWith("*");
      if (start) on = true;
      const word = raw.replace(/\*/g, "");
      const hl = on;
      if (raw.endsWith("*") && (raw.length > 1 || !start)) on = false;
      return { word, hl };
    }),
  );
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((ws, i) => (
        <div key={i} style={{ display: "flex", flexWrap: "wrap", columnGap: Math.round(size * 0.26), lineHeight: lh, minHeight: Math.round(size * lh) }}>
          {ws.map((w, j) => (
            <span key={j} style={w.hl ? { color: accent, fontStyle: italic ? "italic" : "normal" } : {}}>{w.word}</span>
          ))}
        </div>
      ))}
    </div>
  );
}
const plain = (s: string) => s.replace(/\*/g, "");
const lines = (text: string) => text.split("\n").map((s) => s.trim());

// ---------- design ----------

/** logo = the logo with its background removed; light / dark = one-colour versions for backgrounds it would vanish on. */
export type BrandLogo = { src: string; light: string; dark: string; lum: number };
export type Brand = { name: string; site: string; logo: BrandLogo | null };

/** The logo version that reads on this background. */
function logoFor(logo: BrandLogo, bg: string) {
  const l = lum(bg);
  if (l < 0.3 && logo.lum < 0.35) return logo.light;
  if (l > 0.6 && logo.lum > 0.7) return logo.dark;
  return logo.src;
}
type Ctx = { t: Theme; f: Display; brand: Brand; seed: number };

function Logo({ c, size = 44 }: { c: Ctx; size?: number }) {
  if (!c.brand.logo) return <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 700, fontSize: size * 0.62, color: c.t.fg }}>{c.brand.name}</div>;
  return (
    <div style={{ display: "flex" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoFor(c.brand.logo, c.t.bg)} style={{ height: size }} alt="" />
    </div>
  );
}

function Footer({ c }: { c: Ctx }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <Logo c={c} />
      <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 400, fontSize: 28, color: c.t.muted }}>{c.brand.site}</div>
    </div>
  );
}

const PAD = 84;
const INNER = W - PAD * 2;

function TypePoster({ c, text }: { c: Ctx; text: string }) {
  const ls = lines(text).filter(Boolean);
  const kicker = ls.length > 1 ? ls[0] : "";
  const big = (ls.length > 1 ? ls.slice(1) : ls).join("\n");
  const size = fit(plain(big), INNER, 820, c.f.w, c.f.lh, 64, 170);
  const alignBottom = c.seed % 2 === 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: c.t.bg, padding: PAD, justifyContent: "space-between" }}>
      <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: 34, color: c.t.muted }}>{kicker}</div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: alignBottom ? "flex-end" : "center", paddingBottom: alignBottom ? 70 : 0 }}>
        <div style={{ display: "flex", fontFamily: c.f.family, fontWeight: c.f.weight, fontSize: size, lineHeight: c.f.lh, letterSpacing: c.f.ls, color: c.t.fg, whiteSpace: "pre-wrap" }}>
          <Rich text={big} accent={c.t.accent} italic={c.f.italic} size={size} lh={c.f.lh} />
        </div>
      </div>
      <Footer c={c} />
    </div>
  );
}

function Note({ c, text }: { c: Ctx; text: string }) {
  const body = text.trim();
  const size = fit(plain(body), INNER, 880, 0.49, 1.3, 36, 68);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: c.t.bg, padding: PAD, justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22, marginBottom: 46 }}>
        <div style={{ display: "flex", width: 92, height: 92, borderRadius: 46, border: `2px solid ${c.t.line}`, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {c.brand.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoFor(c.brand.logo, c.t.bg)} style={{ width: 70, height: 70, objectFit: "contain" }} alt="" />
          ) : (
            <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 700, fontSize: 40, color: "#111111" }}>{c.brand.name.slice(0, 1)}</div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 700, fontSize: 36, color: c.t.fg }}>{c.brand.name}</div>
          <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 400, fontSize: 28, color: c.t.muted }}>{c.brand.site}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: Math.round(size * 0.7) }}>
        {body.split(/\n\s*\n/).map((para, i) => (
          <div key={i} style={{ display: "flex", fontFamily: "Inter", fontWeight: 400, fontSize: size, lineHeight: 1.3, color: c.t.fg }}>
            <Rich text={para.trim()} accent={c.t.accent} size={size} lh={1.3} />
          </div>
        ))}
      </div>
    </div>
  );
}

function List({ c, text }: { c: Ctx; text: string }) {
  const ls = lines(text).filter(Boolean);
  const title = ls[0] ?? "";
  const items = ls.slice(1, 7).map((x) => x.replace(/^(\d+[.)]|[-*•])\s*/, ""));
  const titleSize = fit(plain(title), INNER, 300, c.f.w, c.f.lh, 52, 112);
  const itemSize = fit(plain(items.join("\n")), INNER - 120, 700 - items.length * 52, 0.5, 1.22, 32, 56);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: c.t.bg, padding: PAD, justifyContent: "space-between" }}>
      <div style={{ display: "flex", fontFamily: c.f.family, fontWeight: c.f.weight, fontSize: titleSize, lineHeight: c.f.lh, letterSpacing: c.f.ls, color: c.t.fg }}>
        <Rich text={title} accent={c.t.accent} italic={c.f.italic} size={titleSize} lh={c.f.lh} />
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((x, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 28, padding: "26px 0", borderTop: `2px solid ${c.t.line}` }}>
            <div style={{ display: "flex", width: 92, flexShrink: 0, fontFamily: c.f.family, fontWeight: c.f.weight, fontSize: Math.round(itemSize * 1.25), lineHeight: 1, color: c.t.accent }}>{String(i + 1).padStart(2, "0")}</div>
            <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 400, fontSize: itemSize, lineHeight: 1.25, color: c.t.fg }}>
              <Rich text={x} accent={c.t.accent} size={itemSize} lh={1.22} />
            </div>
          </div>
        ))}
      </div>
      <Footer c={c} />
    </div>
  );
}

function Versus({ c, text }: { c: Ctx; text: string }) {
  const ls = lines(text).filter(Boolean);
  const title = ls[0] ?? "";
  const [left = "Before", right = "After"] = (ls[1] ?? "").split("|").map((s) => s.trim());
  const rows = ls.slice(2, 8).map((r) => r.split("|").map((s) => s.trim()));
  const titleSize = fit(plain(title), INNER, 260, c.f.w, c.f.lh, 50, 108);
  const colW = Math.floor((INNER - 40) / 2);
  const cell = fit(rows.map((r) => [r[0] ?? "", r[1] ?? ""].sort((a, b) => b.length - a.length)[0]).join("\n"), colW, 700 - rows.length * 46, 0.52, 1.22, 30, 46);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: c.t.bg, padding: PAD, justifyContent: "space-between" }}>
      <div style={{ display: "flex", fontFamily: c.f.family, fontWeight: c.f.weight, fontSize: titleSize, lineHeight: c.f.lh, letterSpacing: c.f.ls, color: c.t.fg }}>
        <Rich text={title} accent={c.t.accent} italic={c.f.italic} size={titleSize} lh={c.f.lh} />
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 40, paddingBottom: 18, borderBottom: `3px solid ${c.t.fg}` }}>
          <div style={{ display: "flex", width: colW, fontFamily: "Inter", fontWeight: 700, fontSize: 36, color: c.t.muted }}>{left}</div>
          <div style={{ display: "flex", width: colW, fontFamily: "Inter", fontWeight: 700, fontSize: 36, color: c.t.accent }}>{right}</div>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 40, padding: "22px 0", borderBottom: `2px solid ${c.t.line}` }}>
            <div style={{ display: "flex", width: colW, fontFamily: "Inter", fontWeight: 400, fontSize: cell, lineHeight: 1.25, color: c.t.muted }}>{r[0] ?? ""}</div>
            <div style={{ display: "flex", width: colW, fontFamily: "Inter", fontWeight: 600, fontSize: cell, lineHeight: 1.25, color: c.t.fg }}>{r[1] ?? ""}</div>
          </div>
        ))}
      </div>
      <Footer c={c} />
    </div>
  );
}

function PhotoPost({ c, photoUrl, top, main, bottom }: { c: Ctx; photoUrl: string; top: string; main: string; bottom: string }) {
  const size = fit(plain(main), INNER - 80, 240, c.f.w, c.f.lh, 56, 110);
  const headline = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {top && <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: 30, color: c.t.muted }}>{top}</div>}
      <div style={{ display: "flex", fontFamily: c.f.family, fontWeight: c.f.weight, fontSize: size, lineHeight: c.f.lh, letterSpacing: c.f.ls, color: c.t.fg }}>
        <Rich text={main} accent={c.t.accent} italic={c.f.italic} size={size} lh={c.f.lh} />
      </div>
      {bottom && <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 400, fontSize: 32, lineHeight: 1.25, color: c.t.fg }}>{bottom}</div>}
    </div>
  );
  if (c.seed % 2 === 0) {
    // Magazine: photo on top, solid panel with the headline below.
    return (
      <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: c.t.bg }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} width={W} height={840} style={{ width: W, height: 840, objectFit: "cover" }} alt="" />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flexGrow: 1, padding: `40px ${PAD}px 48px` }}>
          {headline}
          <Footer c={c} />
        </div>
      </div>
    );
  }
  // Full photo with the headline on a solid card at the bottom.
  return (
    <div style={{ display: "flex", width: W, height: H, background: c.t.bg }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photoUrl} width={W} height={H} style={{ position: "absolute", top: 0, left: 0, width: W, height: H, objectFit: "cover" }} alt="" />
      <div style={{ position: "absolute", left: 56, right: 56, bottom: 56, display: "flex", flexDirection: "column", gap: 30, background: c.t.bg, borderRadius: 18, padding: "40px 44px" }}>
        {headline}
        <Footer c={c} />
      </div>
    </div>
  );
}

/** The concept visual is drawn on this theme's background, so it depends on the post only (not the look variant). */
function conceptTheme(id: string, colors: Pick<Client, "brandPrimaryColor" | "brandSecondaryColor" | "brandAccentColor">) {
  const ts = themes(colors);
  return ts[hash(`${id}:concept`) % ts.length];
}

/** Match the text colours to the real top of the AI visual (the model doesn't always hit the exact background). */
async function fitTheme(t: Theme, photo: Buffer): Promise<Theme> {
  const { channels } = await sharp(photo).extract({ left: 0, top: 0, width: W, height: 420 }).stats();
  const bg = `#${channels.slice(0, 3).map((c) => Math.round(c.mean).toString(16).padStart(2, "0")).join("")}`;
  const light = lum(bg) > 0.35;
  const fg = light ? "#151515" : "#ffffff";
  return { bg, fg, muted: light ? "#000000a6" : "#ffffffb3", accent: readable(t.accent, bg, 3.2), line: t.line, dark: !light };
}

/** Concept: the visual fills the frame; a few words sit in the empty top third. */
function ConceptPost({ c, photoUrl, top, main }: { c: Ctx; photoUrl: string; top: string; main: string }) {
  const size = fit(plain(main), INNER - 120, 300, c.f.w, c.f.lh, 64, 128);
  return (
    <div style={{ display: "flex", width: W, height: H, background: c.t.bg }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photoUrl} width={W} height={H} style={{ position: "absolute", top: 0, left: 0, width: W, height: H, objectFit: "cover" }} alt="" />
      <div style={{ position: "absolute", top: PAD, left: PAD, right: PAD, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: 30, color: c.t.muted }}>{top}</div>
          <Logo c={c} size={38} />
        </div>
        <div style={{ display: "flex", fontFamily: c.f.family, fontWeight: c.f.weight, fontSize: size, lineHeight: c.f.lh, letterSpacing: c.f.ls, color: c.t.fg }}>
          <Rich text={main} accent={c.t.accent} italic={c.f.italic} size={size} lh={c.f.lh} />
        </div>
      </div>
    </div>
  );
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type DesignInput = {
  id: string;
  format: string;
  text: string;
  variant: number;
  top: string;
  main: string;
  bottom: string;
  photo: Buffer | null;
  brand: Brand;
  colors: Pick<Client, "brandPrimaryColor" | "brandSecondaryColor" | "brandAccentColor">;
};

/** Render one design. Returns a 1080x1350 JPEG. */
export async function renderDesign(d: DesignInput): Promise<Buffer> {
  const seed = hash(`${d.id}:${d.variant}`);
  const ts = themes(d.colors);
  // Photo posts never sit on the brand-colour theme (too loud next to a photo).
  const pool = d.format === "photo" ? [ts[0], ts[1], ts[3]] : ts;
  let t = d.format === "concept" ? conceptTheme(d.id, d.colors) : pool[seed % pool.length];
  if (d.format === "concept" && d.photo) t = await fitTheme(t, d.photo);
  const f = DISPLAYS[Math.floor(seed / 7) % DISPLAYS.length];
  const c: Ctx = { t, f, brand: d.brand, seed: Math.floor(seed / 31) };
  const [disp, dispItalic, inter4, inter6, inter7] = await Promise.all([
    googleFont(f.family, f.weight),
    f.italic ? googleFont(f.family, f.weight, true) : Promise.resolve(null),
    googleFont("Inter", 400),
    googleFont("Inter", 600),
    googleFont("Inter", 700),
  ]);
  if (!inter4 || !disp) throw new Error("Could not load fonts, try again");
  let el;
  if (d.format === "concept") {
    if (!d.photo) throw new Error("This post has no visual yet");
    el = <ConceptPost c={c} photoUrl={`data:image/jpeg;base64,${d.photo.toString("base64")}`} top={d.top} main={d.main} />;
  } else if (d.format === "photo") {
    if (!d.photo) throw new Error("This post has no photo yet");
    el = <PhotoPost c={c} photoUrl={`data:image/jpeg;base64,${d.photo.toString("base64")}`} top={d.top} main={d.main} bottom={d.bottom} />;
  } else if (d.format === "note") el = <Note c={c} text={d.text} />;
  else if (d.format === "list") el = <List c={c} text={d.text} />;
  else if (d.format === "versus") el = <Versus c={c} text={d.text} />;
  else el = <TypePoster c={c} text={d.text} />;
  const res = new ImageResponse(el, {
    width: W,
    height: H,
    fonts: [
      { name: f.family, data: disp, weight: f.weight as 400 | 700, style: "normal" as const },
      ...(dispItalic ? [{ name: f.family, data: dispItalic, weight: f.weight as 400 | 700, style: "italic" as const }] : []),
      { name: "Inter", data: inter4, weight: 400 as const, style: "normal" as const },
      ...(inter6 ? [{ name: "Inter", data: inter6, weight: 600 as const, style: "normal" as const }] : []),
      ...(inter7 ? [{ name: "Inter", data: inter7, weight: 700 as const, style: "normal" as const }] : []),
    ],
  });
  const png = Buffer.from(await res.arrayBuffer());
  if (png.length < 1000) throw new Error("Image design failed to render");
  return sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/**
 * Fetch the client's logo and make it sit cleanly on any background: the white (or near-white)
 * background around it is made transparent (only where it touches the edge, so white parts inside
 * the logo stay), the empty margin is trimmed, and one-colour light and dark versions are made.
 */
async function logoData(url: string | null | undefined): Promise<BrandLogo | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; RankflowBot/1.0)" } });
    if (!r.ok) return null;
    return await cleanLogo(Buffer.from(await r.arrayBuffer()));
  } catch {
    return null;
  }
}

export async function cleanLogo(input: Buffer): Promise<BrandLogo> {
  const { data, info } = await sharp(input, { density: 300 }).resize({ height: 240, width: 840, fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = (i: number) => i * 4;
  const whiteish = (i: number) => data[px(i) + 3] < 16 || (data[px(i)] > 228 && data[px(i) + 1] > 228 && data[px(i) + 2] > 228);
  // Flood fill from the edges through white / transparent pixels.
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || !whiteish(i)) continue;
    seen[i] = 1;
    data[px(i) + 3] = 0;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  // Average brightness of what is left (decides when the one-colour versions are needed).
  let sum = 0;
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    const a = data[px(i) + 3];
    if (a < 128) continue;
    sum += lum(`#${[0, 1, 2].map((k) => data[px(i) + k].toString(16).padStart(2, "0")).join("")}`);
    n++;
  }
  // One-colour version: the logo's dark parts in `v`, its light parts cut out (so a white letter
  // inside a dark shape shows the background through, like a knockout).
  const tint = (v: number, keepDark: boolean) => {
    const out = Buffer.from(data);
    for (let i = 0; i < w * h; i++) {
      const l = (0.2126 * data[px(i)] + 0.7152 * data[px(i) + 1] + 0.0722 * data[px(i) + 2]) / 255;
      out.fill(v, px(i), px(i) + 3);
      if ((l < 0.55) !== keepDark) out[px(i) + 3] = 0;
    }
    return out;
  };
  const enc = async (buf: Buffer) => {
    const png = await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer().catch(() => sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer());
    return `data:image/png;base64,${png.toString("base64")}`;
  };
  return { src: await enc(Buffer.from(data)), light: await enc(tint(255, true)), dark: await enc(tint(21, false)), lum: n ? sum / n : 0.5 };
}

/** Design the image of a post (photo = the post's photo, or null for text-first formats). */
export async function designImage(post: SocialPost, project: SocialProject & { client: Client }, photo: Buffer | null): Promise<Buffer> {
  const format = formatOf(post.imageLayout);
  const design = designOf(post.design);
  return renderDesign({
    id: post.id,
    format,
    text: design.texts?.[format]?.trim() || fallbackText(format, post),
    variant: design.variant ?? 0,
    top: post.headlineTop,
    main: post.headlineMain || post.idea.split(" ").slice(0, 5).join(" "),
    bottom: post.headlineBottom,
    photo,
    brand: { name: project.client.name, site: project.client.siteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, ""), logo: await logoData(project.client.logoUrl) },
    colors: project.client,
  });
}

export function imageUrl(post: Pick<SocialPost, "id" | "imageVersion">) {
  const app = (process.env.APP_URL || "https://seo-crm-dashboard-geuv.vercel.app").replace(/\/+$/, "");
  return `${app}/api/social/image/${post.id}.jpg?v=${post.imageVersion}`;
}
