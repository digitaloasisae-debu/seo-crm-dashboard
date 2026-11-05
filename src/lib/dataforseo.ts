/**
 * Keyword checks. Search volume and CPC come from Google Ads Keyword Planner (through DataForSEO's
 * keywords_data/google_ads endpoint); keyword difficulty and intent come from DataForSEO Labs, which also
 * fills in volume for keywords Google Ads won't take.
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

/** POST to any DataForSEO endpoint and return the first task's result array (throws readable errors). */
export async function dfsPost<T = unknown>(path: string, body: unknown[], timeoutMs = 55_000): Promise<T[]> {
  const task = await dfsTask(path, body, timeoutMs);
  return (task.result ?? []) as T[];
}

/** Same as dfsPost but returns the whole task (id, status, result). */
export async function dfsTask(path: string, body: unknown[], timeoutMs = 55_000): Promise<{ id: string; status_code: number; status_message: string; result: unknown[] | null }> {
  if (!dataforseoConfigured()) throw new Error("Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel first");
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64");
  const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: body.length ? "POST" : "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    ...(body.length ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j) throw new Error(res.status === 401 ? "DataForSEO login or password is wrong" : `DataForSEO HTTP ${res.status}`);
  if (j.status_code !== 20000) throw new Error(`DataForSEO: ${j.status_message}`);
  const task = j.tasks?.[0];
  if (!task || task.status_code >= 40000) {
    const m = task?.status_message ?? "unknown error";
    if (task?.status_code === 40200 || /payment|balance|funds/i.test(m)) throw new Error("DataForSEO balance is empty. Add funds at app.dataforseo.com.");
    if (/access denied|subscription|not available for your/i.test(m)) throw new Error(`DataForSEO: ${m}. This API may need to be switched on in your DataForSEO account.`);
    throw new Error(`DataForSEO: ${m}`);
  }
  return task;
}

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

type AdsItem = { keyword: string; search_volume?: number | null; cpc?: number | null };
const norm = (k: string) => k.toLowerCase().trim().replace(/\s+/g, " ");
/** Google Ads rejects keywords with symbols, over 80 characters or over 10 words. */
const adsOk = (k: string) => k.length <= 80 && k.split(" ").length <= 10 && !/[!@%^()=\{\};~`<>?\\|,*]/.test(k);

/** Keyword Planner numbers (Google's own monthly volume). Null if Google Ads data is unavailable. */
async function plannerVolumes(keywords: string[], location: string, language: string): Promise<Map<string, AdsItem> | null> {
  const ok = keywords.filter(adsOk);
  if (!ok.length) return new Map();
  try {
    const items = await dfsPost<AdsItem>("keywords_data/google_ads/search_volume/live", [{ keywords: ok, location_name: location, language_code: language }], 90_000);
    return new Map(items.map((i) => [norm(i.keyword), i]));
  } catch (e) {
    console.error("Keyword Planner volumes failed, using DataForSEO Labs only:", e);
    return null;
  }
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
    const list = batch.map((k) => norm(k.keyword));
    const [items, planner] = await Promise.all([overview(list, location, "en"), plannerVolumes(list, location, "en")]);
    const byKw = new Map(items.map((it) => [norm(it.keyword), it]));
    const now = new Date();
    await db.$transaction(
      batch.map((k) => {
        const it = byKw.get(norm(k.keyword));
        const ads = planner?.get(norm(k.keyword));
        // DataForSEO leaves out keywords it has no data for: that means (almost) nobody searches them.
        return db.keyword.update({
          where: { id: k.id },
          data: {
            // Google's number when it has one; otherwise the Labs estimate; otherwise nobody searches it.
            searchVolume: ads?.search_volume ?? it?.keyword_info?.search_volume ?? 0,
            difficulty: it?.keyword_properties?.keyword_difficulty ?? null,
            cpc: ads?.cpc ?? it?.keyword_info?.cpc ?? null,
            intent: it?.search_intent_info?.main_intent ?? null,
            volumeVerified: true,
            metricsCheckedAt: now,
          },
        });
      }),
    );
    checked += batch.length;
  }
  return { checked, location, source: "Google Keyword Planner + DataForSEO Labs" };
}
