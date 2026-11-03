/** Minimal Gemini client (Google AI Studio API key), JSON output. */
export function geminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function geminiJson<T>(prompt: string, opts: { system?: string; timeoutMs?: number } = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in Vercel");
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 50_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || `HTTP ${res.status}`;
    if (res.status === 402 || /prepayment|credits/i.test(msg)) throw new Error("Gemini has no credit left. Top up in Google AI Studio (ai.studio/projects).");
    throw new Error(`Gemini: ${msg}`);
  }
  const text: string = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
  } catch {
    throw new Error("Gemini returned something that isn't JSON");
  }
}
