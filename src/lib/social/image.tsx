/**
 * Social images in two steps:
 * 1. Gemini draws a photo with NO text in it (from the post's image brief).
 * 2. We set the headline, logo and brand colours on top in code, so text is always spelled right
 *    and every post looks on brand. Output: 1080x1350 JPEG (Instagram, Facebook and LinkedIn).
 */
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { Client, SocialPost, SocialProject } from "@prisma/client";

export const W = 1080;
export const H = 1350;

const imageModels = () => [process.env.GEMINI_IMAGE_MODEL, "gemini-3.1-flash-image", "gemini-2.5-flash-image"].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

/** A text-free photo for the post, as a 1080x1350 JPEG. */
export async function drawPhoto(post: SocialPost, project: SocialProject & { client: Client }): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in Vercel");
  const prompt = [
    `A premium, photorealistic social media photo for ${project.client.name} (${project.client.businessType ?? "business"}, ${[project.client.primaryCity, project.client.targetCountry].filter(Boolean).join(", ")}).`,
    post.imageBrief || post.idea,
    post.imageLayout === "split" ? "Keep the main subject in the upper 60% of the frame." : "Keep the lower third calm and darker (floor, table, wall or soft background) so a headline can sit there; the main subject sits in the upper two thirds.",
    "Shot like an editorial photo by a professional: natural light, shallow depth of field, real textures, true-to-life colours, people look natural and candid (not posing at the camera), correct hands and faces.",
    "ABSOLUTELY NO text, letters, numbers, logos, watermarks, signs, captions or user interfaces anywhere in the image. Screens and papers are blurred or turned away.",
    project.imageStyle ? `Style notes from the owner: ${project.imageStyle}` : "",
    post.imageNote ? `Most important, the owner asked for this change: ${post.imageNote}` : "",
    "Portrait 4:5.",
  ]
    .filter(Boolean)
    .join("\n");
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

// ---------- design layer ----------

let fontCache: Promise<{ bold: ArrayBuffer | null; medium: ArrayBuffer | null }> | null = null;

async function googleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    // Without a browser User-Agent Google serves TrueType, which the renderer needs.
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}`, { signal: AbortSignal.timeout(10_000) })).text();
    const url = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
    if (!url) return null;
    return await (await fetch(url, { signal: AbortSignal.timeout(10_000) })).arrayBuffer();
  } catch {
    return null;
  }
}
function fonts() {
  fontCache ??= Promise.all([googleFont("Plus Jakarta Sans", 800), googleFont("Plus Jakarta Sans", 600)]).then(([bold, medium]) => {
    if (!bold) fontCache = null; // try again next time
    return { bold, medium };
  });
  return fontCache;
}

async function logoData(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; RankflowBot/1.0)" } });
    if (!r.ok) return null;
    const png = await sharp(Buffer.from(await r.arrayBuffer()), { density: 300 }).resize({ height: 120, width: 420, fit: "inside" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

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
/** Darken or lighten a colour by mixing it with black or white. */
function mix(h: string, toward: "#000000" | "#ffffff", amount: number) {
  const a = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(toward.slice(i, i + 2), 16));
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

export type Palette = { dark: string; accent: string };
export function palette(c: Pick<Client, "brandPrimaryColor" | "brandSecondaryColor" | "brandAccentColor">): Palette {
  const primary = hex(c.brandPrimaryColor, "#1e3a8a");
  const candidates = [c.brandAccentColor, c.brandSecondaryColor, c.brandPrimaryColor].map((x) => hex(x, "")).filter(Boolean);
  // Accent must stand out on a dark panel: the brightest brand colour, lightened if needed.
  let accent = candidates.sort((a, b) => lum(b) - lum(a))[0] || "#38bdf8";
  if (lum(accent) < 0.25) accent = mix(accent, "#ffffff", 0.45);
  const dark = lum(primary) > 0.2 ? mix(primary, "#000000", 0.7) : primary;
  return { dark, accent };
}

type Design = {
  photo: Buffer;
  layout: string;
  top: string;
  main: string;
  bottom: string;
  brand: string;
  site: string;
  logo: string | null;
  colors: Palette;
};

function Headline({ d, size }: { d: Design; size: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {d.top && <div style={{ fontSize: size * 0.5, fontWeight: 600, color: "#ffffff", lineHeight: 1.1 }}>{d.top}</div>}
      <div style={{ fontSize: size, fontWeight: 800, color: d.colors.accent, lineHeight: 1.0, letterSpacing: -2 }}>{d.main}</div>
      {d.bottom && <div style={{ fontSize: size * 0.5, fontWeight: 600, color: "#ffffff", lineHeight: 1.15 }}>{d.bottom}</div>}
    </div>
  );
}

function Footer({ d }: { d: Design }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      {d.logo ? (
        <div style={{ display: "flex", background: "#ffffff", borderRadius: 18, padding: "12px 20px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.logo} style={{ height: 52 }} alt="" />
        </div>
      ) : (
        <div style={{ fontSize: 30, fontWeight: 800, color: "#ffffff" }}>{d.brand}</div>
      )}
      <div style={{ display: "flex", fontSize: 26, fontWeight: 600, color: "#ffffff", opacity: 0.85 }}>{d.site}</div>
    </div>
  );
}

function Layout({ d, photoUrl }: { d: Design; photoUrl: string }) {
  const size = Math.max(84, Math.min(136, Math.round(1900 / Math.max(8, d.main.length + 2))));
  if (d.layout === "split") {
    return (
      <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: d.colors.dark, fontFamily: "Jakarta" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} width={W} height={H} style={{ position: "absolute", top: 0, left: 0, width: W, height: H, objectFit: "cover" }} alt="" />
        <div style={{ position: "absolute", top: 760, left: 0, width: W, height: H - 760, display: "flex", background: d.colors.dark }} />
        <div style={{ position: "absolute", top: 760, left: 0, width: W, height: 10, display: "flex", background: d.colors.accent }} />
        <div style={{ position: "absolute", top: 820, left: 70, right: 70, bottom: 60, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <Headline d={d} size={Math.round(size * 0.9)} />
          <Footer d={d} />
        </div>
      </div>
    );
  }
  if (d.layout === "statement") {
    return (
      <div style={{ display: "flex", width: W, height: H, background: d.colors.dark, fontFamily: "Jakarta" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} width={W} height={H} style={{ position: "absolute", top: 0, left: 0, width: W, height: H, objectFit: "cover", opacity: 0.35 }} alt="" />
        <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", backgroundImage: `linear-gradient(160deg, ${d.colors.dark}ee 20%, ${d.colors.dark}88 100%)` }} />
        <div style={{ position: "absolute", top: 90, left: 80, right: 80, bottom: 70, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", width: 120, height: 12, background: d.colors.accent, borderRadius: 6 }} />
          <Headline d={d} size={Math.round(size * 1.1)} />
          <Footer d={d} />
        </div>
      </div>
    );
  }
  // banner (default) and photo: full photo, dark gradient at the bottom, headline on it
  const light = d.layout === "photo";
  return (
    <div style={{ display: "flex", width: W, height: H, background: d.colors.dark, fontFamily: "Jakarta" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photoUrl} width={W} height={H} style={{ position: "absolute", top: 0, left: 0, width: W, height: H, objectFit: "cover" }} alt="" />
      <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0) ${light ? 55 : 38}%, ${d.colors.dark}d9 ${light ? 75 : 62}%, ${d.colors.dark} 100%)` }} />
      <div style={{ position: "absolute", left: 70, right: 70, bottom: 60, display: "flex", flexDirection: "column", gap: 44 }}>
        <div style={{ display: "flex", borderLeft: `10px solid ${d.colors.accent}`, paddingLeft: 30 }}>
          <Headline d={d} size={light ? Math.round(size * 0.8) : size} />
        </div>
        <Footer d={d} />
      </div>
    </div>
  );
}

/** Put the headline, logo and colours on the photo. Returns a 1080x1350 JPEG. */
export async function designImage(post: SocialPost, project: SocialProject & { client: Client }, photo: Buffer): Promise<Buffer> {
  const [f, logo] = await Promise.all([fonts(), logoData(project.client.logoUrl)]);
  const d: Design = {
    photo,
    layout: post.imageLayout,
    top: post.headlineTop,
    main: post.headlineMain || post.idea.split(" ").slice(0, 4).join(" "),
    bottom: post.headlineBottom,
    brand: project.client.name,
    site: project.client.siteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, ""),
    logo,
    colors: palette(project.client),
  };
  const photoUrl = `data:image/jpeg;base64,${photo.toString("base64")}`;
  const res = new ImageResponse(<Layout d={d} photoUrl={photoUrl} />, {
    width: W,
    height: H,
    fonts: [
      ...(f.bold ? [{ name: "Jakarta", data: f.bold, weight: 800 as const, style: "normal" as const }] : []),
      ...(f.medium ? [{ name: "Jakarta", data: f.medium, weight: 600 as const, style: "normal" as const }] : []),
    ],
  });
  const png = Buffer.from(await res.arrayBuffer());
  if (png.length < 1000) throw new Error("Image design failed to render");
  return sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

export function imageUrl(post: Pick<SocialPost, "id" | "imageVersion">) {
  const app = (process.env.APP_URL || "https://seo-crm-dashboard-geuv.vercel.app").replace(/\/+$/, "");
  return `${app}/api/social/image/${post.id}.jpg?v=${post.imageVersion}`;
}
