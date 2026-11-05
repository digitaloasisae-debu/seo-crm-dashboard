/**
 * Backlink data from the DataForSEO Backlinks API: totals, monthly trend, top referring domains,
 * best / new / lost links, anchors, a comparison with competitors, and the link gap
 * (sites that link to competitors but not to this client). One "Refresh" = one snapshot.
 */
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { dfsPost } from "./dataforseo";
import { crawlTarget } from "./crawl";
import { logActivity } from "./activity";

export type BlSummary = {
  rank: number; backlinks: number; referringDomains: number; referringMainDomains: number; referringIps: number;
  nofollow: number; spamScore: number; brokenBacklinks: number; brokenPages: number; firstSeen: string | null;
};
export type BlMonth = { date: string; backlinks: number; referringDomains: number; newDomains: number; lostDomains: number; rank: number };
export type BlDomain = { domain: string; rank: number; backlinks: number; firstSeen: string | null; spam: number };
export type BlLink = { from: string; to: string; domain: string; title: string; anchor: string; rank: number; dofollow: boolean; firstSeen: string | null; lastSeen: string | null; isNew: boolean; isLost: boolean; type: string };
export type BlLinks = { best: BlLink[]; recent: BlLink[]; lost: BlLink[] };
export type BlAnchor = { anchor: string; backlinks: number; domains: number };
export type BlCompetitor = { target: string; rank: number; backlinks: number; referringDomains: number; you: boolean };
export type BlGap = { domain: string; rank: number; backlinks: number; linksTo: string[] };

const RS = { rank_scale: "one_hundred" } as const;
const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const day = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 10) : null);

/** Competitor domains from the client's "competitors" field (URLs or bare domains; names are skipped). */
export function competitorDomains(list: string[], own: string) {
  const out: string[] = [];
  for (const raw of list) {
    for (const part of raw.split(/[\s,;|]+/)) {
      if (!/\.[a-z]{2,}/i.test(part)) continue;
      const d = crawlTarget(part.trim()).toLowerCase();
      if (d && d !== own && !out.includes(d)) out.push(d);
    }
  }
  return out.slice(0, 5);
}

type Raw = Record<string, unknown>;
const items = (r: Raw[] | undefined) => ((r?.[0]?.items as Raw[] | undefined) ?? []);
const link = (i: Raw): BlLink => ({
  from: s(i.url_from), to: s(i.url_to), domain: s(i.domain_from), title: s(i.page_from_title), anchor: s(i.anchor),
  rank: n(i.domain_from_rank), dofollow: !!i.dofollow, firstSeen: day(i.first_seen), lastSeen: day(i.last_seen),
  isNew: !!i.is_new, isLost: !!i.is_lost, type: s(i.item_type),
});

/** Pulls a fresh snapshot (about 9 API calls, run in parallel) and saves it. */
export async function refreshBacklinks(clientId: string, actorId?: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { siteUrl: true, competitors: true } });
  if (!client.siteUrl) throw new Error("This client has no website URL");
  const target = crawlTarget(client.siteUrl);
  const comps = competitorDomains(client.competitors, target);
  const base = { target, include_subdomains: true, exclude_internal_backlinks: true, ...RS };
  const from = new Date(Date.now() - 365 * 864e5);
  from.setUTCDate(1);

  // The summary goes first and alone: if the Backlinks API isn't switched on, this gives the readable error.
  const sum = (await dfsPost<Raw>("backlinks/summary/live", [{ ...base, backlinks_status_type: "live", internal_list_limit: 1 }]))[0] ?? {};
  const soft = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const [hist, doms, best, recent, lost, anch, ranks, bls, rds, gap] = await Promise.all([
    soft(dfsPost<Raw>("backlinks/history/live", [{ target, date_from: from.toISOString().slice(0, 10), ...RS }]), []),
    soft(dfsPost<Raw>("backlinks/referring_domains/live", [{ ...base, backlinks_status_type: "live", limit: 50, order_by: ["rank,desc"] }]), []),
    soft(dfsPost<Raw>("backlinks/backlinks/live", [{ ...base, mode: "one_per_domain", backlinks_status_type: "live", limit: 50, order_by: ["domain_from_rank,desc"] }]), []),
    soft(dfsPost<Raw>("backlinks/backlinks/live", [{ ...base, mode: "as_is", backlinks_status_type: "live", limit: 25, order_by: ["first_seen,desc"] }]), []),
    soft(dfsPost<Raw>("backlinks/backlinks/live", [{ ...base, mode: "as_is", backlinks_status_type: "lost", limit: 25, order_by: ["last_seen,desc"] }]), []),
    soft(dfsPost<Raw>("backlinks/anchors/live", [{ ...base, backlinks_status_type: "live", limit: 15, order_by: ["backlinks,desc"] }]), []),
    comps.length ? soft(dfsPost<Raw>("backlinks/bulk_ranks/live", [{ targets: [target, ...comps], ...RS }]), []) : Promise.resolve([]),
    comps.length ? soft(dfsPost<Raw>("backlinks/bulk_backlinks/live", [{ targets: [target, ...comps] }]), []) : Promise.resolve([]),
    comps.length ? soft(dfsPost<Raw>("backlinks/bulk_referring_domains/live", [{ targets: [target, ...comps] }]), []) : Promise.resolve([]),
    comps.length
      ? soft(dfsPost<Raw>("backlinks/domain_intersection/live", [{ targets: Object.fromEntries(comps.map((c, i) => [String(i + 1), c])), exclude_targets: [target], intersection_mode: "partial", include_subdomains: true, exclude_internal_backlinks: true, limit: 100, ...RS }]), [])
      : Promise.resolve([]),
  ]);

  const attrs = (sum.referring_links_attributes ?? {}) as Record<string, number>;
  const summary: BlSummary = {
    rank: n(sum.rank), backlinks: n(sum.backlinks), referringDomains: n(sum.referring_domains), referringMainDomains: n(sum.referring_main_domains),
    referringIps: n(sum.referring_ips), nofollow: n(attrs.nofollow), spamScore: n(sum.backlinks_spam_score),
    brokenBacklinks: n(sum.broken_backlinks), brokenPages: n(sum.broken_pages), firstSeen: day(sum.first_seen),
  };
  const history: BlMonth[] = items(hist).map((i) => ({
    date: s(i.date).slice(0, 7), backlinks: n(i.backlinks), referringDomains: n(i.referring_domains),
    newDomains: n(i.new_referring_domains), lostDomains: n(i.lost_referring_domains), rank: n(i.rank),
  })).filter((m) => m.date).sort((a, b) => a.date.localeCompare(b.date));
  const domains: BlDomain[] = items(doms).map((i) => ({ domain: s(i.domain), rank: n(i.rank), backlinks: n(i.backlinks), firstSeen: day(i.first_seen), spam: n(i.backlinks_spam_score) }));
  const links: BlLinks = { best: items(best).map(link), recent: items(recent).map(link), lost: items(lost).map(link) };
  const anchors: BlAnchor[] = items(anch).map((i) => ({ anchor: s(i.anchor), backlinks: n(i.backlinks), domains: n(i.referring_domains) }));

  let competitors: BlCompetitor[] | null = null;
  if (comps.length) {
    const by = (r: Raw[], key: string) => new Map(items(r).map((i) => [s(i.target).toLowerCase(), n(i[key])]));
    const rk = by(ranks, "rank"), bl = by(bls, "backlinks"), rd = by(rds, "referring_domains");
    competitors = [target, ...comps].map((t) => ({
      target: t, you: t === target,
      rank: t === target ? summary.rank : rk.get(t) ?? 0,
      backlinks: t === target ? summary.backlinks : bl.get(t) ?? 0,
      referringDomains: t === target ? summary.referringDomains : rd.get(t) ?? 0,
    }));
  }

  // domain_intersection items look like { domain_intersection: { "1": {target: "<referring domain>", rank, backlinks}, "2": null }, summary }
  let linkGap: BlGap[] | null = null;
  if (comps.length) {
    const m = new Map<string, BlGap>();
    for (const it of items(gap)) {
      const inter = ((it.domain_intersection ?? it) as Record<string, Raw | null>);
      for (const [k, v] of Object.entries(inter)) {
        const idx = Number(k) - 1;
        if (!v || typeof v !== "object" || !(idx >= 0 && idx < comps.length)) continue;
        const d = s(v.target) || s(v.domain);
        if (!d) continue;
        const g = m.get(d) ?? { domain: d, rank: 0, backlinks: 0, linksTo: [] };
        g.rank = Math.max(g.rank, n(v.rank));
        g.backlinks += n(v.backlinks);
        if (!g.linksTo.includes(comps[idx])) g.linksTo.push(comps[idx]);
        m.set(d, g);
      }
    }
    linkGap = [...m.values()].sort((a, b) => b.linksTo.length - a.linksTo.length || b.rank - a.rank).slice(0, 50);
  }

  const report = await db.backlinkReport.create({
    data: {
      clientId, target, createdById: actorId ?? null,
      summary: summary as unknown as Prisma.InputJsonValue,
      history: history as unknown as Prisma.InputJsonValue,
      domains: domains as unknown as Prisma.InputJsonValue,
      links: links as unknown as Prisma.InputJsonValue,
      anchors: anchors as unknown as Prisma.InputJsonValue,
      competitors: (competitors ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      gap: (linkGap ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
    },
  });
  await logActivity({ actorId, clientId, action: "backlinks.refresh", entity: "client", entityId: clientId, after: { backlinks: summary.backlinks, referringDomains: summary.referringDomains } });
  return report;
}
