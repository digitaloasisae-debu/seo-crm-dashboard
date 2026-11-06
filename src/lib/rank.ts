/**
 * Rank tracker: daily Google positions (organic and the local map pack) for each client's tracked
 * keywords, via DataForSEO SERP tasks (standard queue, top 30 results). DataForSEO pings
 * /api/rank/pingback when a task is ready; the daily cron collects anything the pings missed.
 */
import { db } from "./db";
import { dataforseoConfigured } from "./dataforseo";
import { pingbackToken } from "./crawl";
import { logActivity } from "./activity";

const DEPTH = 30;
const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[/?#].*$/, "").toLowerCase();

async function dfs(path: string, body?: unknown[]) {
  if (!dataforseoConfigured()) throw new Error("Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel first");
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64");
  const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const j = (await res.json().catch(() => null)) as { status_code?: number; status_message?: string; tasks?: { id: string; status_code: number; status_message: string; data?: { tag?: string }; result?: unknown[] | null }[] } | null;
  if (!res.ok || !j) throw new Error(res.status === 401 ? "DataForSEO login or password is wrong" : `DataForSEO HTTP ${res.status}`);
  if (j.status_code !== 20000) throw new Error(`DataForSEO: ${j.status_message}`);
  return j.tasks ?? [];
}

type Loc = { location_name?: string; location_coordinate?: string; label: string };

/** Where to search from: the client's own setting, else its first Google profile's pin, else the target country. */
export async function rankLocation(clientId: string): Promise<Loc> {
  const c = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { rankLocation: true, targetCountry: true, gbpProfiles: { select: { data: true, label: true }, orderBy: { createdAt: "asc" }, take: 1 } } });
  if (c.rankLocation?.trim()) return { location_name: c.rankLocation.trim(), label: c.rankLocation.trim() };
  const d = c.gbpProfiles[0]?.data as { latitude?: number; longitude?: number; address?: string } | null | undefined;
  if (d?.latitude && d?.longitude) return { location_coordinate: `${d.latitude},${d.longitude},5000`, label: `Near ${d.address ?? c.gbpProfiles[0].label}` };
  const country = c.targetCountry?.trim() || process.env.DATAFORSEO_DEFAULT_COUNTRY || "United States";
  return { location_name: country, label: country };
}

/** Queue a check for these keywords (all of the client's when ids is empty). */
export async function queueRankChecks(clientId: string, opts: { ids?: string[]; priority?: 1 | 2 } = {}) {
  const [kws, loc] = await Promise.all([
    db.rankKeyword.findMany({ where: { clientId, ...(opts.ids?.length ? { id: { in: opts.ids } } : {}) }, select: { id: true, keyword: true } }),
    rankLocation(clientId),
  ]);
  if (!kws.length) return 0;
  const app = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const ping = app.startsWith("https://") ? `${app}/api/rank/pingback?id=$id&tag=$tag&t=${pingbackToken()}` : undefined;
  let queued = 0;
  for (let i = 0; i < kws.length; i += 100) {
    const batch = kws.slice(i, i + 100);
    const tasks = await dfs(
      "serp/google/organic/task_post",
      batch.map((k) => ({
        keyword: k.keyword,
        language_code: "en",
        depth: DEPTH,
        priority: opts.priority ?? 1,
        tag: k.id,
        ...(loc.location_coordinate ? { location_coordinate: loc.location_coordinate } : { location_name: loc.location_name }),
        ...(ping ? { pingback_url: ping } : {}),
      })),
    );
    for (const t of tasks) {
      const id = t.data?.tag;
      if (!id) continue;
      if (t.status_code < 40000) {
        await db.rankKeyword.update({ where: { id }, data: { pendingTask: t.id, error: null } });
        queued++;
      } else await db.rankKeyword.update({ where: { id }, data: { error: t.status_message } });
    }
  }
  return queued;
}

type SerpItem = { type: string; rank_group?: number; url?: string; domain?: string; title?: string; cid?: string; items?: SerpItem[] };

/** Read a finished task and save the positions. Returns false if it isn't ready yet. */
export async function collectRankTask(taskId: string): Promise<boolean> {
  const kw = await db.rankKeyword.findFirst({ where: { pendingTask: taskId }, include: { client: { select: { id: true, name: true, siteUrl: true, gbpProfiles: { select: { cid: true } } } } } });
  if (!kw) return true;
  const [task] = await dfs(`serp/google/organic/task_get/regular/${taskId}`);
  if (!task) return false;
  if (task.status_code === 40602 || task.status_code === 40601) return false; // in queue / in progress
  if (task.status_code >= 40000) {
    await db.rankKeyword.update({ where: { id: kw.id }, data: { pendingTask: null, error: task.status_message } });
    return true;
  }
  const items = ((task.result?.[0] as { items?: SerpItem[] } | undefined)?.items ?? []) as SerpItem[];
  const site = host(kw.client.siteUrl);
  const cids = new Set(kw.client.gbpProfiles.map((g) => g.cid).filter(Boolean) as string[]);
  const name = kw.client.name.toLowerCase();
  const organic = items.filter((i) => i.type === "organic").find((i) => (i.domain && host(i.domain) === site) || (i.url && host(i.url) === site));
  // Map pack: either one "local_pack" item per business, or a container with nested items.
  const pack = items.flatMap((i) => (i.type === "local_pack" ? (i.items?.length ? i.items : [i]) : []));
  const packIdx = pack.findIndex((p) => (p.cid && cids.has(p.cid)) || (p.domain && host(p.domain) === site) || (p.url && host(p.url) === site) || (!!p.title && p.title.toLowerCase().includes(name)));
  const position = organic?.rank_group ?? null;
  const mapPosition = packIdx >= 0 ? packIdx + 1 : null;
  const today = new Date(new Date().toISOString().slice(0, 10));
  const prev = kw.position;
  await db.$transaction([
    db.rankCheck.upsert({ where: { rankKeywordId_date: { rankKeywordId: kw.id, date: today } }, create: { rankKeywordId: kw.id, date: today, position, mapPosition, url: organic?.url ?? null }, update: { position, mapPosition, url: organic?.url ?? null } }),
    db.rankKeyword.update({
      where: { id: kw.id },
      data: { position, mapPosition, url: organic?.url ?? null, prevPosition: prev, bestPosition: position && (!kw.bestPosition || position < kw.bestPosition) ? position : kw.bestPosition, checkedAt: new Date(), pendingTask: null, error: null },
    }),
  ]);
  // Alerts: into the top 10, out of the top 10, or a big move.
  const moved = (a: number | null, b: number | null) => (a ?? 101) - (b ?? 101);
  if (kw.checkedAt) {
    const up = moved(prev, position);
    const into10 = position != null && position <= 10 && (prev == null || prev > 10);
    const outOf10 = prev != null && prev <= 10 && (position == null || position > 10);
    if (into10 || outOf10 || Math.abs(up) >= 5) {
      await logActivity({ clientId: kw.clientId, action: up > 0 ? "rank.up" : "rank.down", entity: "rankKeyword", entityId: kw.id, before: { position: prev }, after: { keyword: kw.keyword, position, into10, outOf10 } });
    }
  }
  return true;
}

/** Daily: collect finished tasks, then queue today's checks for keywords not checked in the last 20 hours. */
export async function dailyRanks(budgetMs = 40_000) {
  const started = Date.now();
  let collected = 0, queued = 0;
  const pending = await db.rankKeyword.findMany({ where: { pendingTask: { not: null } }, select: { pendingTask: true }, take: 300 });
  for (const p of pending) {
    if (Date.now() - started > budgetMs / 2) break;
    if (await collectRankTask(p.pendingTask!).catch(() => false)) collected++;
  }
  const due = await db.rankKeyword.groupBy({
    by: ["clientId"],
    where: { pendingTask: null, client: { status: "ACTIVE" }, OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(Date.now() - 20 * 3600_000) } }] },
  });
  for (const d of due) {
    if (Date.now() - started > budgetMs) break;
    const ids = (await db.rankKeyword.findMany({ where: { clientId: d.clientId, pendingTask: null, OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(Date.now() - 20 * 3600_000) } }] }, select: { id: true } })).map((k) => k.id);
    queued += await queueRankChecks(d.clientId, { ids }).catch(() => 0);
  }
  return { collected, queued };
}

/** Suggest keywords to track: approved keywords and the focus keywords of published articles. */
export async function suggestRankKeywords(clientId: string) {
  const [kws, arts, tracked] = await Promise.all([
    db.keyword.findMany({ where: { clientId, status: "APPROVED" }, select: { keyword: true }, orderBy: { searchVolume: { sort: "desc", nulls: "last" } }, take: 40 }),
    db.article.findMany({ where: { clientId, status: "PUSHED_DRAFT" }, select: { focusKeyword: true }, take: 40 }),
    db.rankKeyword.findMany({ where: { clientId }, select: { keyword: true } }),
  ]);
  const have = new Set(tracked.map((t) => t.keyword.toLowerCase()));
  return [...new Set([...arts.map((a) => a.focusKeyword), ...kws.map((k) => k.keyword)].map((k) => k.trim().toLowerCase()))].filter((k) => k && !have.has(k)).slice(0, 30);
}
