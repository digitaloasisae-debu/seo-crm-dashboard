/** The agency's own branding for client reports (PDF cover and footer, report emails). Set on the SEO page. */
import { db } from "./db";

export type Agency = { name: string; logo: string | null; website: string; email: string };
const KEY = "report_agency";

export async function getAgency(): Promise<Agency> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  let v: Partial<Agency> = {};
  try { v = row ? JSON.parse(row.value) : {}; } catch { /* ignore */ }
  return { name: v.name || process.env.REPORT_AGENCY_NAME || "Digital Oasis", logo: v.logo || null, website: v.website || "", email: v.email || "" };
}

export async function saveAgency(a: Agency) {
  const value = JSON.stringify(a);
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

/** A data: URL (png/jpg) → the shape @react-pdf's <Image> accepts. */
export function logoForPdf(dataUrl: string | null): { data: Buffer; format: "png" | "jpg" } | null {
  const m = dataUrl?.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  return m ? { data: Buffer.from(m[2], "base64"), format: m[1].toLowerCase() === "png" ? "png" : "jpg" } : null;
}
