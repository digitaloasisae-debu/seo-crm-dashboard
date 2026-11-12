/**
 * The real-photo library of a social project: photos Hamza uploads (team, office, real work,
 * screenshots of results). The AI describes each one, and the copywriter picks a fitting one
 * for "photo" posts instead of generating a fake.
 */
import sharp from "sharp";
import { db } from "../db";

/** Store one uploaded photo (already resized in the browser; resized again here to be safe). */
export async function addMedia(projectId: string, file: Buffer) {
  const img = sharp(file, { failOn: "none" }).rotate();
  const data = await img.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const meta = await sharp(data).metadata();
  return db.socialMedia.create({ data: { projectId, data: new Uint8Array(data), width: meta.width ?? 0, height: meta.height ?? 0 } });
}

/** Let Gemini describe what a photo shows, so the copywriter can match it to posts. */
export async function describeMedia(id: string) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return;
  const m = await db.socialMedia.findUnique({ where: { id }, include: { project: { include: { client: { select: { name: true, businessType: true } } } } } });
  if (!m) return;
  const small = await sharp(Buffer.from(m.data)).resize({ width: 768, height: 768, fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
  const model = process.env.GEMINI_SOCIAL_MODEL || process.env.GEMINI_MODEL || "gemini-flash-latest";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: small.toString("base64") } },
            { text: `This is a real photo from ${m.project.client.name} (${m.project.client.businessType ?? "business"}), to be used in their social posts. In 1-2 plain sentences say what it shows (people, place, objects, what is happening, mood, any visible screen or document), and which kinds of posts it would suit. Return JSON: {"description":"..."}` },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await res.json().catch(() => ({}));
  try {
    const text = j?.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text ?? "").join("") ?? "";
    const description = String(JSON.parse(text).description ?? "").trim().slice(0, 600);
    if (description) await db.socialMedia.update({ where: { id }, data: { description } });
  } catch (e) {
    console.error("social.describe_failed", id, e);
  }
}

/** The least-used library photo other than `not` (for "use another photo"). */
export async function nextMedia(projectId: string, not?: string | null) {
  return db.socialMedia.findFirst({ where: { projectId, ...(not ? { id: { not } } : {}) }, orderBy: [{ usedCount: "asc" }, { createdAt: "desc" }], select: { id: true } });
}
