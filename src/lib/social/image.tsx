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

import { designOf, fallbackText, formatOf, type Slide } from "./formats";
export { FORMATS, FORMAT_HELP, PICTURE_FORMATS, TEXT_FORMATS, designOf, fallbackText, formatOf, isFormat, type DesignData } from "./formats";

// ---------- AI pictures ----------

/** Google Imagen 4 first (best quality), then Gemini's own image models ("Nano Banana") as a fallback. */
const imageModels = () =>
  [process.env.GEMINI_IMAGE_MODEL, "imagen-4.0-generate-001", "gemini-3.1-flash-image", "gemini-2.5-flash-image"].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

/**
 * The exact prompt the image model gets (the post card shows it, and Hamza can edit it). The
 * copywriter writes it as a plain, literal description of one scene that shows the post's topic.
 */
export function imagePrompt(post: Pick<SocialPost, "imageBrief" | "idea">, project: Pick<SocialProject, "imageStyle">) {
  return [
    post.imageBrief.trim() || `A realistic, well-lit photo that clearly shows: ${post.idea}`,
    "No text, letters, numbers, logos or watermarks anywhere in the image.",
    project.imageStyle.trim() ? `Style notes: ${project.imageStyle.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A new AI picture for the post, from its prompt. */
export function drawAI(post: SocialPost, project: SocialProject) {
  return generateImage(imagePrompt(post, project));
}

/** A library photo, cropped to the post size. */
export function fitPhoto(data: Uint8Array | Buffer) {
  return sharp(Buffer.from(data)).rotate().resize(W, H, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
}

/** Ask Google's image models for a picture; returns a 1080x1350 JPEG. */
async function generateImage(prompt: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in Vercel");
  let lastErr = "";
  for (const model of imageModels()) {
    const imagen = model.startsWith("imagen");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${imagen ? "predict" : "generateContent"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(
        imagen
          ? { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: "3:4", personGeneration: "allow_adult" } }
          : { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:5" } } },
      ),
      signal: AbortSignal.timeout(150_000),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 404 || res.status === 400 || res.status === 403) {
      lastErr = `${model}: ${j?.error?.message || `HTTP ${res.status}`}`;
      continue; // model not available on this key (or not for this request): try the next one
    }
    if (!res.ok) {
      const msg = j?.error?.message || `HTTP ${res.status}`;
      if (res.status === 402 || /prepayment|credits/i.test(msg)) throw new Error("Gemini has no credit left. Top up in Google AI Studio.");
      throw new Error(`Image model: ${msg}`);
    }
    let b64: string | undefined;
    if (imagen) b64 = j?.predictions?.[0]?.bytesBase64Encoded;
    else {
      const parts: { inlineData?: { data: string }; inline_data?: { data: string } }[] = j?.candidates?.[0]?.content?.parts ?? [];
      const data = parts.find((x) => x.inlineData || x.inline_data);
      b64 = data?.inlineData?.data ?? data?.inline_data?.data;
    }
    if (!b64) {
      // Usually a safety filter on this prompt: let the next model try.
      lastErr = `${model} returned no image (${j?.predictions?.[0]?.raiFilteredReason ?? j?.candidates?.[0]?.finishReason ?? j?.promptFeedback?.blockReason ?? "no reason given"})`;
      continue;
    }
    return sharp(Buffer.from(b64, "base64")).resize(W, H, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
  }
  throw new Error(`No image made: ${lastErr}`);
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

type Ctx = { t: Theme; f: Display; brand: Brand; seed: number };

// Hamza asked (2026-11-13) for no logo, brand name or website on the images: these render nothing,
// so every layout keeps its spacing. The captions carry the brand.
function Logo(_: { c: Ctx; size?: number }) {
  return <div style={{ display: "flex" }} />;
}

function Footer(_: { c: Ctx }) {
  return <div style={{ display: "flex" }} />;
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

/** Concept: the headline on a solid band in the post's colours, the AI picture filling the rest. */
function ConceptPost({ c, photoUrl, top, main }: { c: Ctx; photoUrl: string; top: string; main: string }) {
  const size = fit(plain(main), INNER, 250, c.f.w, c.f.lh, 60, 118);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: c.t.bg }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: `${PAD - 20}px ${PAD}px 44px` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 40 }}>
          <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: 30, color: c.t.muted }}>{top}</div>
          <Logo c={c} size={38} />
        </div>
        <div style={{ display: "flex", fontFamily: c.f.family, fontWeight: c.f.weight, fontSize: size, lineHeight: c.f.lh, letterSpacing: c.f.ls, color: c.t.fg }}>
          <Rich text={main} accent={c.t.accent} italic={c.f.italic} size={size} lh={c.f.lh} />
        </div>
      </div>
      <div style={{ display: "flex", flexGrow: 1, overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} width={W} height={H} style={{ width: W, height: "100%", objectFit: "cover" }} alt="" />
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

type Fonts = ConstructorParameters<typeof ImageResponse>[1] extends infer O ? (O extends { fonts?: infer F } ? F : never) : never;

/** The look of a post (theme + font pairing) and the fonts it needs. */
async function lookOf(d: Pick<DesignInput, "id" | "format" | "variant" | "photo" | "brand" | "colors">): Promise<{ c: Ctx; fonts: Fonts }> {
  const seed = hash(`${d.id}:${d.variant}`);
  const ts = themes(d.colors);
  // Photo posts never sit on the brand-colour theme (too loud next to a photo).
  const pool = d.format === "photo" ? [ts[0], ts[1], ts[3]] : ts;
  let t = d.format === "concept" ? conceptTheme(d.id, d.colors) : pool[seed % pool.length];
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
  const fonts = [
    { name: f.family, data: disp, weight: f.weight as 400 | 700, style: "normal" as const },
    ...(dispItalic ? [{ name: f.family, data: dispItalic, weight: f.weight as 400 | 700, style: "italic" as const }] : []),
    { name: "Inter", data: inter4, weight: 400 as const, style: "normal" as const },
    ...(inter6 ? [{ name: "Inter", data: inter6, weight: 600 as const, style: "normal" as const }] : []),
    ...(inter7 ? [{ name: "Inter", data: inter7, weight: 700 as const, style: "normal" as const }] : []),
  ] as Fonts;
  return { c, fonts };
}

async function png(el: React.ReactElement, fonts: Fonts, width = W, height = H) {
  const res = new ImageResponse(el, { width, height, fonts });
  const out = Buffer.from(await res.arrayBuffer());
  if (out.length < 500) throw new Error("Image design failed to render");
  return out;
}
const jpeg = async (p: Buffer) => sharp(p).jpeg({ quality: 90, mozjpeg: true }).toBuffer();

/** Render one design. Returns a 1080x1350 JPEG. */
export async function renderDesign(d: DesignInput): Promise<Buffer> {
  const { c, fonts } = await lookOf(d);
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
  return jpeg(await png(el, fonts));
}

// ---------- carousel ----------

function SlideCard({ c, n, total, title, body }: { c: Ctx; n: number; total: number; title: string; body: string }) {
  const tSize = fit(plain(title), INNER, 380, c.f.w, c.f.lh, 64, 118);
  const bSize = fit(plain(body), INNER, 420, 0.5, 1.32, 34, 50);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: c.t.bg, padding: PAD }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, fontFamily: "Inter", fontSize: 34 }}>
          <div style={{ display: "flex", fontWeight: 700, color: c.t.accent }}>{String(n).padStart(2, "0")}</div>
          <div style={{ display: "flex", fontWeight: 400, color: c.t.muted }}>{`/ ${String(total).padStart(2, "0")}`}</div>
        </div>
        <Logo c={c} size={38} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: 44 }}>
        <div style={{ display: "flex", width: 120, height: 10, background: c.t.accent }} />
        <div style={{ display: "flex", fontFamily: c.f.family, fontWeight: c.f.weight, fontSize: tSize, lineHeight: c.f.lh, letterSpacing: c.f.ls, color: c.t.fg }}>
          <Rich text={title} accent={c.t.accent} italic={c.f.italic} size={tSize} lh={c.f.lh} />
        </div>
        {body ? (
          <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 400, fontSize: bSize, lineHeight: 1.32, color: c.t.fg, opacity: 0.86 }}>
            <Rich text={body} accent={c.t.accent} size={bSize} lh={1.32} />
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{ display: "flex", height: 8, width: i + 1 === n ? 56 : 18, borderRadius: 4, background: i + 1 === n ? c.t.accent : c.t.muted, opacity: i + 1 === n ? 1 : 0.35 }} />
        ))}
        <div style={{ display: "flex", flexGrow: 1 }} />
        <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: 28, color: c.t.muted }}>{n < total ? "Swipe" : ""}</div>
      </div>
    </div>
  );
}

function EndSlide({ c, text }: { c: Ctx; text: string }) {
  const size = fit(plain(text), INNER, 520, c.f.w, c.f.lh, 64, 130);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: c.t.bg, padding: PAD, justifyContent: "space-between" }}>
      <div style={{ display: "flex" }} />
      <div style={{ display: "flex", fontFamily: c.f.family, fontWeight: c.f.weight, fontSize: size, lineHeight: c.f.lh, letterSpacing: c.f.ls, color: c.t.fg }}>
        <Rich text={text} accent={c.t.accent} italic={c.f.italic} size={size} lh={c.f.lh} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", height: 2, width: "100%", background: c.t.line }} />
        <Footer c={c} />
      </div>
    </div>
  );
}

/**
 * The carousel slides after the cover: one per point, then a closing slide. They share the
 * cover's look (the same theme and fonts), so the carousel reads as one piece.
 */
export async function renderSlides(d: DesignInput, slides: Slide[], end: string): Promise<Buffer[]> {
  const { c, fonts } = await lookOf(d);
  const total = slides.length + 2;
  const out: Buffer[] = [];
  for (const [i, s] of slides.entries()) out.push(await jpeg(await png(<SlideCard c={c} n={i + 2} total={total} title={s.title} body={s.body} />, fonts)));
  out.push(await jpeg(await png(<EndSlide c={c} text={end || "Save this for later"} />, fonts)));
  return out;
}

// ---------- reel ----------

export const RW = 1080;
export const RH = 1920;

/** One line of the Reel, as a transparent layer. Over a concept visual it sits in the empty top; otherwise in a solid block. */
function ReelText({ c, text, boxed, small }: { c: Ctx; text: string; boxed: boolean; small?: boolean }) {
  const size = fit(plain(text), RW - 2 * PAD - (boxed ? 80 : 0), 520, c.f.w, c.f.lh, 60, small ? 96 : 132);
  const words = (
    <div style={{ display: "flex", fontFamily: c.f.family, fontWeight: c.f.weight, fontSize: size, lineHeight: c.f.lh, letterSpacing: c.f.ls, color: c.t.fg }}>
      <Rich text={text} accent={c.t.accent} italic={c.f.italic} size={size} lh={c.f.lh} />
    </div>
  );
  return (
    <div style={{ display: "flex", width: RW, height: RH, padding: PAD, paddingTop: 230, flexDirection: "column" }}>
      {boxed ? <div style={{ display: "flex", background: c.t.bg, padding: 40, borderRadius: 8 }}>{words}</div> : words}
    </div>
  );
}

/** The end layer of a Reel (empty: no logo or website on the images). */
function ReelBrand(_: { c: Ctx }) {
  return <div style={{ display: "flex", width: RW, height: RH }} />;
}

/**
 * The pieces of a Reel: the background frame (1080x1920 JPEG: the visual on its flat colour, a
 * full-bleed photo, or just the theme colour) and one transparent PNG per line of text, plus the
 * brand card for the end. src/lib/social/video.ts animates them.
 */
export async function reelLayers(d: DesignInput, scenes: string[]): Promise<{ base: Buffer; lines: Buffer[]; brand: Buffer }> {
  const { c, fonts } = await lookOf(d);
  // The picture fills the frame (the words sit on solid blocks), or just the theme colour.
  const base = d.photo
    ? await sharp(d.photo).resize(RW, RH, { fit: "cover", position: "attention" }).jpeg({ quality: 92 }).toBuffer()
    : await sharp({ create: { width: RW, height: RH, channels: 3, background: c.t.bg } }).jpeg({ quality: 92 }).toBuffer();
  const boxed = Boolean(d.photo);
  const lines = [];
  for (const s of scenes) lines.push(await png(<ReelText c={c} text={s} boxed={boxed} />, fonts, RW, RH));
  const brand = await png(<ReelBrand c={c} />, fonts, RW, RH);
  return { base, lines, brand };
}

/**
 * Fetch the client's logo and make it sit cleanly on any background: the white (or near-white)
 * background around it is made transparent (only where it touches the edge, so white parts inside
 * the logo stay), the empty margin is trimmed, and one-colour light and dark versions are made.
 */
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
  return renderDesign(await designInput(post, project, photo));
}

export async function designInput(post: SocialPost, project: SocialProject & { client: Client }, photo: Buffer | null): Promise<DesignInput> {
  const format = formatOf(post.imageLayout);
  const design = designOf(post.design);
  return {
    id: post.id,
    format,
    text: design.texts?.[format]?.trim() || fallbackText(format, post),
    variant: design.variant ?? 0,
    top: post.headlineTop,
    main: post.headlineMain || post.idea.split(" ").slice(0, 5).join(" "),
    bottom: post.headlineBottom,
    photo,
    brand: { name: project.client.name, site: project.client.siteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, ""), logo: null },
    colors: project.client,
  };
}

const appUrl = () => (process.env.APP_URL || "https://seo-crm-dashboard-geuv.vercel.app").replace(/\/+$/, "");

export function imageUrl(post: Pick<SocialPost, "id" | "imageVersion">) {
  return `${appUrl()}/api/social/image/${post.id}.jpg?v=${post.imageVersion}`;
}

/** Every image of a carousel in order: the cover, then the slides. */
export function carouselUrls(post: Pick<SocialPost, "id" | "imageVersion">, slides: number) {
  return [imageUrl(post), ...Array.from({ length: slides }, (_, i) => `${appUrl()}/api/social/image/${post.id}-${i + 2}.jpg?v=${post.imageVersion}`)];
}

export function videoUrl(post: Pick<SocialPost, "id" | "imageVersion">) {
  return `${appUrl()}/api/social/video/${post.id}.mp4?v=${post.imageVersion}`;
}
