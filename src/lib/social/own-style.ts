// "Copy my page's style" (Hamza, 2026-11-24): study the account's own 10-15 best posts and make every
// new image in the same design (layout, fonts, colours, photo style). Only the topic and title change.
import sharp from "sharp";
import { db } from "../db";
import { W, H } from "./image";

const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v26.0"}`;
const enc = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

async function graph<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const r = await fetch(`${GRAPH()}/${path}?${enc({ ...params, access_token: token })}`, { signal: AbortSignal.timeout(30_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j as T;
}

type Top = { image: string; text: string; score: number; where: string };

/** The account's own posts with a picture, best first (Facebook Page, plus Instagram when linked). */
async function ownTopPosts(p: { fbPageId: string | null; igUserId: string | null }): Promise<{ posts: Top[]; problems: string[] }> {
  const user = process.env.META_ACCESS_TOKEN;
  if (!user) return { posts: [], problems: ["META_ACCESS_TOKEN is not set"] };
  const posts: Top[] = [];
  const problems: string[] = [];
  if (p.fbPageId) {
    try {
      // A Page token reads the Page's posts with their numbers; fall back to the user token.
      const pageToken = await graph<{ access_token?: string }>(p.fbPageId, { fields: "access_token" }, user).then((r) => r.access_token ?? user).catch(() => user);
      const r = await graph<{ data: { message?: string; full_picture?: string; shares?: { count: number }; reactions?: { summary?: { total_count: number } }; comments?: { summary?: { total_count: number } } }[] }>(
        `${p.fbPageId}/posts`,
        { fields: "message,full_picture,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)", limit: "100" },
        pageToken,
      );
      for (const x of r.data ?? []) {
        if (!x.full_picture) continue;
        posts.push({ image: x.full_picture, text: x.message ?? "", score: (x.reactions?.summary?.total_count ?? 0) + 2 * (x.comments?.summary?.total_count ?? 0) + 3 * (x.shares?.count ?? 0), where: "Facebook" });
      }
    } catch (e) {
      problems.push(`Facebook Page: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    let ig = p.igUserId;
    if (!ig && p.fbPageId) ig = (await graph<{ instagram_business_account?: { id: string } }>(p.fbPageId, { fields: "instagram_business_account" }, user).catch(() => ({}) as { instagram_business_account?: { id: string } })).instagram_business_account?.id ?? null;
    if (ig) {
      const r = await graph<{ data: { caption?: string; media_type?: string; media_url?: string; thumbnail_url?: string; like_count?: number; comments_count?: number }[] }>(`${ig}/media`, { fields: "caption,media_type,media_url,thumbnail_url,like_count,comments_count", limit: "60" }, user);
      for (const x of r.data ?? []) {
        const image = x.media_type === "VIDEO" ? x.thumbnail_url : x.media_url;
        if (image) posts.push({ image, text: x.caption ?? "", score: (x.like_count ?? 0) + 2 * (x.comments_count ?? 0), where: "Instagram" });
      }
    }
  } catch (e) {
    problems.push(`Instagram: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { posts: posts.sort((a, b) => b.score - a.score).slice(0, 15), problems };
}

async function download(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return await sharp(buf).rotate().resize({ width: 1080, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
}

type Part = { inlineData?: { mimeType: string; data: string }; text?: string };
const imgPart = (b: Buffer): Part => ({ inlineData: { mimeType: "image/jpeg", data: b.toString("base64") } });

async function geminiParts(model: string, parts: Part[], config: Record<string, unknown>, timeoutMs: number) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: config }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || `HTTP ${res.status}`;
    if (res.status === 402 || /prepayment|credits/i.test(msg)) throw new Error("Gemini has no credit left. Top up in Google AI Studio.");
    throw Object.assign(new Error(`${model}: ${msg}`), { status: res.status });
  }
  return (j?.candidates?.[0]?.content?.parts ?? []) as { text?: string; inlineData?: { data: string }; inline_data?: { data: string } }[];
}

/** Study the best posts and save up to 4 style references plus notes. `uploads` = images Hamza added by hand. */
export async function learnOwnStyle(projectId: string, uploads: Buffer[] = []) {
  const p = await db.socialProject.findUniqueOrThrow({ where: { id: projectId }, include: { client: { select: { name: true } } } });
  const { posts, problems } = uploads.length ? { posts: [] as Top[], problems: [] as string[] } : await ownTopPosts(p);
  const images: Buffer[] = [];
  const texts: string[] = [];
  for (const u of uploads) {
    const b = await sharp(u).rotate().resize({ width: 1080, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer().catch(() => null);
    if (b) images.push(b);
  }
  for (const x of posts) {
    if (images.length >= 15) break;
    const b = await download(x.image);
    if (!b) continue;
    images.push(b);
    if (x.text.trim()) texts.push(`- (${x.where}, score ${x.score}) ${x.text.replace(/\s+/g, " ").slice(0, 400)}`);
  }
  if (!images.length) {
    const msg = problems.join(" · ") || "No posts with images found. Add the Facebook Page ID in Settings, or upload a few of your best posts.";
    await db.socialProject.update({ where: { id: projectId }, data: { styleError: msg.slice(0, 1000) } });
    throw new Error(msg);
  }
  const ask = `These are the ${images.length} best-performing posts of ${p.client.name}'s own social media account, best first.
${texts.length ? `Their captions:\n${texts.join("\n")}\n` : ""}
Describe the shared design so a designer can make new posts that look like they belong to the same feed:
- "visual": 8-12 concrete bullet points: real photo vs designed graphic vs product shot, the main subject and how it is shot, background, layout and where the text sits, the headline style (length, case, font family look, weight, colours, outlines or boxes), colour palette with hex guesses, borders, frames, badges, how polished or raw it looks.
- "captions": 4-6 bullet points on how the captions read (length, tone, emojis, structure, call to action, hashtags). Empty list if there are no captions.
Return JSON: {"visual":["..."],"captions":["..."]}`;
  const model = process.env.GEMINI_SOCIAL_MODEL || process.env.GEMINI_MODEL || "gemini-flash-latest";
  const parts = await geminiParts(model, [...images.slice(0, 15).map(imgPart), { text: ask }], { responseMimeType: "application/json", temperature: 0.2 }, 150_000);
  let notes = "";
  try {
    const j = JSON.parse(parts.map((x) => x.text ?? "").join("")) as { visual?: string[]; captions?: string[] };
    notes = [`LOOK OF THE BEST POSTS:`, ...(j.visual ?? []).map((x) => `- ${x}`), ...(j.captions?.length ? [`HOW THE CAPTIONS READ:`, ...j.captions.map((x) => `- ${x}`)] : [])].join("\n");
  } catch {
    notes = "";
  }
  await db.socialProject.update({
    where: { id: projectId },
    data: { styleRefs: images.slice(0, 4).map((b) => new Uint8Array(b)), styleNotes: notes, styleAt: new Date(), styleError: problems.length ? problems.join(" · ").slice(0, 1000) : null },
  });
  return { found: images.length, notes };
}

/** Text for the copywriter: how the account's best posts look and read. */
export function styleText(p: { ownStyle: boolean; styleNotes: string }) {
  return p.ownStyle && p.styleNotes.trim() ? `## THIS ACCOUNT'S OWN BEST POSTS (copy this style; only the topic and title change)\n${p.styleNotes}` : "";
}

/** A new post image in the account's own style, made by Nano Banana from the reference posts. */
export async function drawInOwnStyle(
  post: { idea: string; headlineTop: string; headlineMain: string; headlineBottom: string; imageBrief: string },
  project: { styleRefs: Uint8Array[]; styleNotes: string; imageStyle: string },
): Promise<Buffer> {
  const refs = project.styleRefs.map((b) => imgPart(Buffer.from(b)));
  const words = [post.headlineTop, post.headlineMain, post.headlineBottom].map((x) => x.replace(/\*/g, "").trim()).filter(Boolean);
  const ask = `The ${refs.length} images above are this brand's own best-performing social media posts.
Make ONE new post image that looks like it belongs in the same feed: copy their design exactly (layout, where the text sits, the headline font look, weight, colours and effects, background treatment, borders, badges, photo style and lighting). Do not copy their wording or their exact subject.
COPY THE DESIGN, NOT THE CONTENT: do not copy any words from the reference posts (no taglines, footers, call-to-action strips, phone numbers, websites or slogans such as "Let's talk..."). The ONLY text on the new image is the text given below. Show a NEW subject: follow "What to show" for the object, its design, shape, colour and setting, so it does not look like the products in the references.
NO LOGOS: leave out any logo, brand mark, brand name, website, handle or watermark the reference posts have (Hamza's rule: no logos on posts). No company names on products either.
Only the content changes:
- Topic: ${post.idea}
- What to show: ${post.imageBrief || post.idea}
${words.length ? `- Text on the image, spelled exactly like this and nothing else: ${words.map((w) => `"${w}"`).join(" / ")}` : "- No text on the image."}
${project.styleNotes ? `\nNotes on the style:\n${project.styleNotes.split("HOW THE CAPTIONS READ:")[0].split("\n").filter((l) => !/logo|brand mark|watermark|tagline|footer|call[- ]to[- ]action|cta/i.test(l)).join("\n").replace(/["“][^"”]{3,80}["”]/g, "(their words)").trim()}` : ""}
${project.imageStyle.trim() ? `\nAlso: ${project.imageStyle.trim()}` : ""}
Vertical 4:5 image. No logo, brand name or watermark anywhere. No people's faces unless the reference posts show people.`;
  let lastErr = "";
  for (const model of [process.env.GEMINI_STYLE_IMAGE_MODEL, "gemini-3.1-flash-image", "gemini-2.5-flash-image"].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i)) {
    try {
      const parts = await geminiParts(model, [...refs, { text: ask }], { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:5" } }, 150_000);
      const data = parts.find((x) => x.inlineData || x.inline_data);
      const b64 = data?.inlineData?.data ?? data?.inline_data?.data;
      if (!b64) { lastErr = `${model} returned no image`; continue; }
      return sharp(Buffer.from(b64, "base64")).resize(W, H, { fit: "cover", position: "attention" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (!/^gemini-[^:]+: /.test(lastErr) || !/404|not found|not supported|400/i.test(lastErr + String((e as { status?: number }).status ?? ""))) throw e;
    }
  }
  throw new Error(`No image made: ${lastErr}`);
}
