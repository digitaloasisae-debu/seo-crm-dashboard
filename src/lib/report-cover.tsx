/**
 * The cover header shared by the audit PDFs: one logo (the agency's, or the client's when the agency
 * has none), cleaned so it sits straight on the page with no white box, on a soft tint of the brand colour.
 */
import { Circle, Image, Svg, Text, View } from "@react-pdf/renderer";

export type PdfLogo = { data: Buffer; format: "png" | "jpg"; ratio?: number } | null;

/**
 * Make a logo print well: knock out a solid white (or near-white) background, trim the empty margins
 * around it (square uploads often have lots), and return a PNG with its aspect ratio.
 * Falls back to the original image when anything goes wrong.
 */
export async function polishLogo(logo: PdfLogo): Promise<PdfLogo> {
  if (!logo) return null;
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(logo.data).ensureAlpha();
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = info;
    const at = (x: number, y: number) => (y * w + x) * c;
    // Only knock out white when the corners are white and opaque (a JPG or a flattened PNG).
    const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
    const whiteBg = corners.every((i) => data[i + 3] > 240 && data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235);
    if (whiteBg) {
      for (let i = 0; i < data.length; i += c) {
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        // Pure white disappears; light greys fade, so anti-aliased edges stay smooth.
        if (min >= 245) data[i + 3] = 0;
        else if (min >= 215) data[i + 3] = Math.round(data[i + 3] * ((245 - min) / 30));
      }
    }
    const trimmed = await sharp(data, { raw: { width: w, height: h, channels: c } })
      .trim({ threshold: 1 })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { data: trimmed.data, format: "png", ratio: trimmed.info.width / Math.max(1, trimmed.info.height) };
  } catch (e) {
    console.error("Logo clean-up failed, using it as uploaded:", e);
    return logo;
  }
}

/** A soft tint of a hex colour (mixed with white). */
export function tint(hex: string, amount = 0.92) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * amount);
  return `#${[mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Fit a logo into a box without stretching it. */
function logoSize(logo: NonNullable<PdfLogo>, maxW: number, maxH: number) {
  const r = logo.ratio ?? 3;
  let height = maxH, width = maxH * r;
  if (width > maxW) { width = maxW; height = maxW / r; }
  return { width, height };
}

export function CoverHero({ logo, brand, color, kicker, title, subtitle, meta, height = 290 }: { logo: PdfLogo; brand: string; color: string; kicker: string; title: string; subtitle: string; meta: string; height?: number }) {
  return (
    <View style={{ height, backgroundColor: tint(color, 0.93), paddingHorizontal: 48, paddingTop: 42, position: "relative" }}>
      {/* Decorative rings, top right */}
      <Svg width={260} height={260} style={{ position: "absolute", top: -70, right: -60 }}>
        <Circle cx={130} cy={130} r={128} fill={color} fillOpacity={0.06} />
        <Circle cx={130} cy={130} r={96} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={1.2} />
        <Circle cx={130} cy={130} r={62} fill="none" stroke={color} strokeOpacity={0.28} strokeWidth={1.2} />
        <Circle cx={130} cy={130} r={30} fill={color} fillOpacity={0.12} />
      </Svg>
      {logo ? <Image src={logo} style={logoSize(logo, 210, 52)} /> : <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold", color }}>{brand}</Text>}
      <View style={{ position: "absolute", left: 48, right: 48, bottom: 34 }}>
        <View style={{ width: 34, height: 3, backgroundColor: color, borderRadius: 2, marginBottom: 12 }} />
        <Text style={{ fontSize: 9.5, letterSpacing: 2, color, fontFamily: "Helvetica-Bold" }}>{kicker.toUpperCase()}</Text>
        <Text style={{ fontSize: 30, lineHeight: 1.15, fontFamily: "Helvetica-Bold", color: "#0f172a", marginTop: 6 }}>{title}</Text>
        <Text style={{ fontSize: 12, color, marginTop: 5 }}>{subtitle}</Text>
        <Text style={{ fontSize: 9.5, color: "#64748b", marginTop: 10 }}>{meta}</Text>
      </View>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: color }} />
    </View>
  );
}
