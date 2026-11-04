/**
 * Keyword checks with DataForSEO Labs (search volume, keyword difficulty, CPC, intent).
 * Weak keywords are flagged in the dashboard; they are not rejected, so Tally keywords still auto-approve.
 */
import { db } from "./db";

export const LOW_VOLUME = 20; // monthly searches below this = "low volume"
export const HARD_KD = 60; // keyword difficulty at or above this = "hard"

export function dataforseoConfigured() {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

export function keywordFlags(k: { searchVolume: number | null; difficulty: number | null; metricsCheckedAt: Date | null }) {
  if (!k.metricsCheckedAt) return [];
  const flags: ("low" | "hard")[] = [];
  if ((k.searchVolume ?? 0) < LOW_VOLUME) flags.push("low");
  if (k.difficulty != null && k.difficulty >= HARD_KD) flags.push("hard");
  return flags;
}

type Item = {
  keyword: string;
  keyword_info?: { search_volume?: number | null; cpc?: number | null };
  keyword_properties?: { keyword_difficulty?: number | null };
  search_intent_info?: { main_intent?: string | null };
};

async function overview(keywords: string[], location: string, language: string): Promise<Item[]> {
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64");
  const res = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify([{ keywords, location_name: location, language_code: language, include_serp_info: false }]),
    signal: AbortSignal.timeout(55_000),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j) throw new Error(res.status === 401 ? "DataForSEO login or password is wrong" : `DataForSEO HTTP ${res.status}`);
  if (j.status_code !== 20000) throw new Error(`DataForSEO: ${j.status_message}`);
  const task = j.tasks?.[0];
  if (task?.status_code !== 20000) {
    if (task?.status_code === 40200 || /payment|balance|funds/i.test(task?.status_message ?? "")) throw new Error("DataForSEO balance is empty. Add funds at app.dataforseo.com.");
    throw new Error(`DataForSEO: ${task?.status_message ?? "unknown error"}`);
  }
  return task.result?.[0]?.items ?? [];
}

/** Checks a client's keywords (by default only the ones never checked). Returns how many were checked. */
export async function checkKeywords(clientId: string, opts: { all?: boolean; ids?: string[] } = {}) {
  if (!dataforseoConfigured()) throw new Error("Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel first");
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { targetCountry: true } });
  const keywords = await db.keyword.findMany({
    where: { clientId, ...(opts.ids ? { id: { in: opts.ids } } : opts.all ? {} : { metricsCheckedAt: null }) },
    select: { id: true, keyword: true, keywordNorm: true },
    take: 2000,
  });
  const location = client.targetCountry?.trim() || process.env.DATAFORSEO_DEFAULT_COUNTRY || "United States";
  let checked = 0;
  for (let i = 0; i < keywords.length; i += 700) {
    const batch = keywords.slice(i, i + 700);
    const items = await overview(batch.map((k) => k.keyword.toLowerCase()), location, "en");
    const byKw = new Map(items.map((it) => [it.keyword.toLowerCase().trim().replace(/\s+/g, " "), it]));
    const now = new Date();
    await db.$transaction(
      batch.map((k) => {
        const it = byKw.get(k.keyword.toLowerCase().trim().replace(/\s+/g, " "));
        // DataForSEO leaves out keywords it has no data for: that means (almost) nobody searches them.
        return db.keyword.update({
          where: { id: k.id },
          data: {
            searchVolume: it?.keyword_info?.search_volume ?? 0,
            difficulty: it?.keyword_properties?.keyword_difficulty ?? null,
            cpc: it?.keyword_info?.cpc ?? null,
            intent: it?.search_intent_info?.main_intent ?? null,
            volumeVerified: true,
            metricsCheckedAt: now,
          },
        });
      }),
    );
    checked += batch.length;
  }
  return { checked, location };
}
