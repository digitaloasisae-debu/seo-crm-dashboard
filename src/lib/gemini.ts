/** Minimal Gemini client (Google AI Studio API key), JSON output. */
export function geminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function geminiJson<T>(prompt: string, opts: { system?: string; timeoutMs?: number; model?: string; temperature?: number } = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in Vercel");
  const model = opts.model || process.env.GEMINI_MODEL || "gemini-flash-latest";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: opts.temperature ?? 0.2 },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 50_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || `HTTP ${res.status}`;
    if (res.status === 402 || /prepayment|credits/i.test(msg)) throw new Error("Gemini has no credit left. Top up in Google AI Studio (ai.studio/projects).");
    throw new Error(`Gemini: ${msg}`);
  }
  if (j?.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new Error("Gemini ran out of room before finishing. Try again, or ask for a shorter change.");
  const text: string = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
  } catch {
    throw new Error("Gemini returned something that isn't JSON");
  }
}

export type GroundSource = { url: string; title: string };

/** Google redirect links in grounding results point at the real page: follow them once. */
async function realUrl(u: string) {
  try {
    const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    return r.headers.get("location") || u;
  } catch {
    return u;
  }
}

/**
 * Gemini with Google Search grounding: it searches the web before answering, so dates, names and facts are current.
 * JSON mode can't be combined with search on every model, so the JSON is read from the text.
 */
export async function geminiGrounded<T>(prompt: string, opts: { system?: string; timeoutMs?: number; model?: string; temperature?: number } = {}): Promise<{ data: T; sources: GroundSource[] }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in Vercel");
  const model = opts.model || process.env.GEMINI_MODEL || "gemini-flash-latest";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: opts.temperature ?? 0.4 },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || `HTTP ${res.status}`;
    if (res.status === 402 || /prepayment|credits/i.test(msg)) throw new Error("Gemini has no credit left. Top up in Google AI Studio (ai.studio/projects).");
    throw new Error(`Gemini: ${msg}`);
  }
  const cand = j?.candidates?.[0];
  const text: string = cand?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  const json = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let data: T;
  try {
    data = JSON.parse(json) as T;
  } catch {
    throw new Error("Gemini returned something that isn't JSON");
  }
  const chunks: { web?: { uri?: string; title?: string } }[] = cand?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: GroundSource[] = [];
  const urls = await Promise.all(chunks.slice(0, 12).map((c) => (c.web?.uri ? realUrl(c.web.uri) : Promise.resolve(""))));
  for (const [i, c] of chunks.slice(0, 12).entries()) {
    const url = urls[i];
    if (!url || !c.web || seen.has(url)) continue;
    seen.add(url);
    sources.push({ url, title: c.web.title ?? url });
  }
  return { data, sources };
}
