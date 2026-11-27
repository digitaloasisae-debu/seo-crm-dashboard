/**
 * Real moving Reels (Hamza, 2026-11-27: "I don't want static reels with a background and changing text,
 * I want real reels with moving scenes that make sense"). Google Veo makes each scene as a short clip,
 * on the same Gemini API key. Model: GEMINI_VIDEO_MODEL, default Veo 3.1 Fast.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** How many scenes (clips) one Reel has: SOCIAL_REEL_CLIPS, 1-3 (Hamza chose 1, 8 seconds, on 2026-11-27). */
export function reelClips() {
  return Math.max(1, Math.min(3, Math.round(Number(process.env.SOCIAL_REEL_CLIPS) || 1)));
}

/** Seconds per clip: one clip gets 8s, two or three get 6s each (Veo makes 4, 6 or 8 seconds). */
export function clipSeconds(clips = reelClips()) {
  return clips === 1 ? 8 : 6;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One vertical clip for a scene. Takes 1-3 minutes. */
export async function makeClip(scene: string, seconds = clipSeconds()): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_VIDEO_MODEL || "veo-3.1-fast-generate-preview";
  const prompt = `${scene.trim()}
Realistic, natural-looking video, as if filmed on a good phone: smooth, slow camera movement, real light, real places and objects. Vertical 9:16.
No people, faces, hands or bodies. No text, letters, captions, subtitles, logos, brand names or watermarks anywhere.`;
  const start = await fetch(`${BASE}/models/${model}:predictLongRunning`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { aspectRatio: "9:16", durationSeconds: seconds, negativePrompt: "people, person, face, hands, text, letters, subtitles, logo, watermark, cartoon, 3D render, distorted objects" },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const op = await start.json().catch(() => ({}));
  if (!start.ok || !op?.name) {
    const msg = op?.error?.message || `HTTP ${start.status}`;
    if (start.status === 429) throw new Error("Video (Veo) limit reached for now; press Try again later");
    if (/billing|prepayment|credits|paid/i.test(msg)) throw new Error(`Video (Veo) needs a paid Gemini plan with credit: ${msg}`);
    throw new Error(`Video (Veo): ${msg}`);
  }
  // Poll until the clip is made (up to about 5 minutes).
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const r = await fetch(`${BASE}/${op.name}`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(30_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Video (Veo): ${j?.error?.message || `HTTP ${r.status}`}`);
    if (!j.done) continue;
    if (j.error) throw new Error(`Video (Veo): ${j.error.message || "failed"}`);
    const res = j.response?.generateVideoResponse ?? j.response ?? {};
    const filtered = res.raiMediaFilteredReasons?.[0];
    const uri: string | undefined = res.generatedSamples?.[0]?.video?.uri ?? res.generatedVideos?.[0]?.video?.uri;
    if (!uri) throw new Error(`Video (Veo) made no clip${filtered ? `: ${filtered}` : ""}`);
    const file = await fetch(uri, { headers: { "x-goog-api-key": key }, redirect: "follow", signal: AbortSignal.timeout(120_000) });
    if (!file.ok) throw new Error(`Video (Veo) download failed: HTTP ${file.status}`);
    return Buffer.from(await file.arrayBuffer());
  }
  throw new Error("Video (Veo) took too long, it will be retried");
}
