/**
 * Keyword reuse and internal link ideas.
 * - usage(): which of the client's articles already target the same (or nearly the same) keyword,
 *   so two blogs don't compete for one search on Google.
 * - linkIdeas(): the client's live pages most related to a keyword, to link to from a new blog.
 */
import { db } from "./db";

const STOP = new Set(["the", "and", "for", "with", "your", "you", "how", "what", "why", "best", "near", "me", "a", "an", "of", "to", "in", "on", "is", "are", "vs", "do", "does", "can", "my", "our"]);
const stem = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** Lowercase, no punctuation, singular words. "Gate Repairs!" → "gate repair". */
export const normKeyword = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).map(stem).join(" ");
const tokens = (s: string) => new Set(normKeyword(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w)));

/** "same" when the keywords match after normalising, "similar" when they share most of their words. */
export function keywordMatch(a: string, b: string): "same" | "similar" | null {
  const na = normKeyword(a), nb = normKeyword(b);
  if (!na || !nb) return null;
  if (na === nb) return "same";
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return null;
  const inter = [...ta].filter((w) => tb.has(w)).length;
  const small = Math.min(ta.size, tb.size), big = Math.max(ta.size, tb.size);
  // e.g. "gate repair katy" vs "katy gate repair", or "gate repair" inside "gate repair houston".
  if (inter === small && big - small <= 1) return "similar";
  return null;
}

export type UsedBy = { id: string; title: string; status: string; url: string | null; keyword: string; match: "same" | "similar"; imported: boolean };

type Art = { id: string; metaTitle: string; focusKeyword: string; status: string; wpPostUrl: string | null; importedAt: Date | null };

/** Articles of a client whose focus keyword matches `keyword` . */
export function usageIn(arts: Art[], keyword: string, excludeId?: string): UsedBy[] {
  const out: UsedBy[] = [];
  for (const a of arts) {
    if (a.id === excludeId) continue;
    const m = keywordMatch(keyword, a.focusKeyword);
    if (m) out.push({ id: a.id, title: a.metaTitle, status: a.status, url: a.wpPostUrl, keyword: a.focusKeyword, match: m, imported: !!a.importedAt });
  }
  return out.sort((x, y) => (x.match === y.match ? 0 : x.match === "same" ? -1 : 1));
}

export async function clientArticles(clientId: string) {
  return db.article.findMany({ where: { clientId, status: { notIn: ["GENERATING"] } }, select: { id: true, metaTitle: true, focusKeyword: true, status: true, wpPostUrl: true, importedAt: true, slug: true, wpTitle: true } });
}

export type LinkIdea = { url: string; title: string; anchor: string; score: number; linked: boolean; articleId?: string };

const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

/**
 * Live pages on the client's site that are most related to the keyword: good internal links for a blog on it.
 * Scored by shared words in the page's keyword, title and URL. Pages already linked from `bodyHtml` are marked.
 */
export async function linkIdeas(clientId: string, keyword: string, opts: { excludeId?: string; bodyHtml?: string; limit?: number } = {}): Promise<LinkIdea[]> {
  const [arts, client] = await Promise.all([
    db.article.findMany({ where: { clientId, id: opts.excludeId ? { not: opts.excludeId } : undefined, status: "PUSHED_DRAFT", wpPostUrl: { not: null } }, select: { id: true, metaTitle: true, wpTitle: true, focusKeyword: true, wpPostUrl: true, slug: true, importedAt: true } }),
    db.client.findUnique({ where: { id: clientId }, select: { linkPool: true, gscPages: { select: { page: true, clicks: true }, orderBy: { clicks: "desc" }, take: 60 } } }),
  ]);
  const kw = tokens(keyword);
  if (!kw.size) return [];
  const linked = new Set([...(opts.bodyHtml ?? "").matchAll(/href=["']([^"']+)["']/gi)].map((m) => normUrl(m[1])));
  const ideas = new Map<string, LinkIdea>();
  const score = (text: string) => { const t = tokens(text); return [...kw].filter((w) => t.has(w)).length / kw.size; };
  for (const a of arts) {
    // Skip Rankflow drafts whose permalink isn't real yet (?p=123).
    if (!a.wpPostUrl || /[?&]p=\d+/.test(a.wpPostUrl)) continue;
    const s = Math.max(score(a.focusKeyword) * 1.1, score(`${a.wpTitle ?? a.metaTitle} ${a.slug.replace(/-/g, " ")}`));
    if (s <= 0) continue;
    ideas.set(normUrl(a.wpPostUrl), { url: a.wpPostUrl, title: a.wpTitle ?? a.metaTitle, anchor: a.focusKeyword, score: s, linked: linked.has(normUrl(a.wpPostUrl)), articleId: a.id });
  }
  // Key pages (services, locations) and pages already earning Google clicks.
  for (const u of [...(client?.linkPool ?? []), ...(client?.gscPages ?? []).map((p) => p.page)]) {
    const k = normUrl(u);
    if (ideas.has(k) || !/^https?:/i.test(u)) continue;
    const path = k.split("/").slice(1).join(" ").replace(/[-_]/g, " ");
    if (!path) continue;
    const s = score(path) * 0.9;
    if (s <= 0) continue;
    const anchor = path.split(" ").filter(Boolean).slice(-4).join(" ");
    ideas.set(k, { url: u, title: path.replace(/\b\w/g, (c) => c.toUpperCase()), anchor, score: s, linked: linked.has(k) });
  }
  return [...ideas.values()].sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 6);
}

/** Fast lookup for many keywords at once (keywords and topics tables). */
export function usageIndex(arts: Art[]) {
  const pre = arts.filter((a) => a.focusKeyword).map((a) => ({ a, n: normKeyword(a.focusKeyword) }));
  const byNorm = new Map<string, Art[]>();
  for (const { a, n } of pre) byNorm.set(n, [...(byNorm.get(n) ?? []), a]);
  return (keyword: string, excludeId?: string): UsedBy[] => {
    const n = normKeyword(keyword);
    const out: UsedBy[] = (byNorm.get(n) ?? []).filter((a) => a.id !== excludeId).map((a) => ({ id: a.id, title: a.metaTitle, status: a.status, url: a.wpPostUrl, keyword: a.focusKeyword, match: "same" as const, imported: !!a.importedAt }));
    for (const { a, n: an } of pre) {
      if (an === n || a.id === excludeId) continue;
      if (keywordMatch(keyword, a.focusKeyword) === "similar") out.push({ id: a.id, title: a.metaTitle, status: a.status, url: a.wpPostUrl, keyword: a.focusKeyword, match: "similar", imported: !!a.importedAt });
    }
    return out;
  };
}
