/**
 * Bring a client's existing WordPress posts and pages into Rankflow (through the saved WordPress
 * login), so the refresh finder, internal links and AI rewrites work on older content too.
 * Imported items are stored as articles already live on the site (status PUSHED_DRAFT, importedAt set).
 * Running it again adds new posts and re-syncs untouched ones; items in review are left alone.
 */
import { db } from "./db";
import { wpFetch } from "./wordpress";
import { logActivity } from "./activity";
import { findRefreshes } from "./refresh";
import { normalizeKeyword } from "./utils";

type WpItem = {
  id: number;
  link: string;
  slug: string;
  modified_gmt?: string;
  title?: { raw?: string; rendered?: string };
  content?: { raw?: string; rendered?: string };
  excerpt?: { raw?: string; rendered?: string };
  meta?: Record<string, unknown>;
  yoast_head_json?: { title?: string; description?: string };
};

const decode = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, "-").replace(/&#8212;|&mdash;/g, "-").replace(/&amp;/g, "&").replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&nbsp;|&#160;/g, " ").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const BUILDER = /elementor|et_pb_|\[vc_row|fl-builder|brxe-|wp-block-uagb|oxy-|tcb-/i;

/** A focus keyword when no SEO plugin has one: the headline without the brand part, lowercased. */
function guessKeyword(title: string) {
  return title.split(/\s[|–-]\s/)[0].replace(/[^\p{L}\p{N}\s'&]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120);
}

export async function importFromWordPress(clientId: string, opts: { pages?: boolean; actorId?: string; budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 50_000;
  const cred = await db.clientCredential.findUnique({ where: { clientId_kind: { clientId, kind: "WORDPRESS" } } });
  if (!cred) throw new Error("Save this client's WordPress login on the Settings tab first");
  const existing = await db.article.findMany({ where: { clientId, wpPostId: { not: null } }, select: { id: true, wpPostId: true, wpType: true, importedAt: true, status: true, revisingAt: true } });
  const key = (type: string, id: number) => `${type}:${id}`;
  const have = new Map(existing.map((a) => [key(a.wpType ?? "post", a.wpPostId!), a]));

  let added = 0, updated = 0, skipped = 0, partial = false;
  for (const type of opts.pages ? (["post", "page"] as const) : (["post"] as const)) {
    for (let page = 1; page <= 20; page++) {
      if (Date.now() - started > budget) { partial = true; break; }
      let items: WpItem[];
      try {
        items = (await wpFetch(cred, `/${type}s?status=publish&per_page=50&page=${page}&context=edit&_fields=id,link,slug,modified_gmt,title,content,excerpt,meta,yoast_head_json`)) as unknown as WpItem[];
      } catch (e) {
        // WordPress answers 400 when asking past the last page.
        if (page > 1 && /WordPress 400/.test(String(e))) break;
        throw e;
      }
      if (!Array.isArray(items) || !items.length) break;
      for (const it of items) {
        const old = have.get(key(type, it.id));
        // Rankflow's own posts, and imported ones being reviewed or rewritten, are not overwritten.
        if (old && (!old.importedAt || old.status !== "PUSHED_DRAFT" || old.revisingAt)) { skipped++; continue; }
        const raw = it.content?.raw ?? it.content?.rendered ?? "";
        const headline = decode(it.title?.raw ?? it.title?.rendered ?? "") || it.slug;
        const m = it.meta ?? {};
        const rmTitle = str(m.rank_math_title);
        const seoTitle = rmTitle && !rmTitle.includes("%") ? rmTitle : decode(it.yoast_head_json?.title ?? "") || headline;
        const rmDesc = str(m.rank_math_description);
        const desc = (rmDesc && !rmDesc.includes("%") ? rmDesc : decode(it.yoast_head_json?.description ?? "") || decode(it.excerpt?.raw ?? it.excerpt?.rendered ?? "")).slice(0, 320);
        const kw = str(m.rank_math_focus_keyword).split(",")[0].trim() || guessKeyword(headline);
        const text = decode(raw);
        const builder = BUILDER.test(raw) || BUILDER.test(it.content?.rendered ?? "") || text.length < 150;
        const data = {
          metaTitle: seoTitle.slice(0, 200),
          wpTitle: headline.slice(0, 300),
          slug: it.slug,
          metaDescription: desc || null,
          focusKeyword: kw || headline.toLowerCase(),
          bodyHtml: raw,
          wpPostUrl: it.link,
          wpType: type,
          wpBuilder: builder,
        };
        const when = it.modified_gmt ? new Date(`${it.modified_gmt}Z`) : new Date();
        let articleId: string;
        if (old) {
          await db.article.update({ where: { id: old.id }, data });
          articleId = old.id;
          updated++;
        } else {
          articleId = (await db.article.create({ data: { ...data, clientId, wpPostId: it.id, status: "PUSHED_DRAFT", pushedAt: when, importedAt: new Date() } })).id;
          added++;
        }
        // Blog posts (and pages with a real SEO-plugin keyword) also fill the Keywords and Topics tabs.
        const realKw = !!str(m.rank_math_focus_keyword);
        if (type === "post" || realKw) await linkKeywordAndTopic(clientId, articleId, { keyword: data.focusKeyword, title: data.wpTitle, when });
      }
      if (items.length < 50) break;
    }
  }
  await logActivity({ actorId: opts.actorId, clientId, action: "article.import", entity: "client", entityId: clientId, after: { added, updated, skipped } });
  // Pages that were losing clicks can now be rewritten here.
  await findRefreshes(clientId).catch(() => 0);
  return { added, updated, skipped, partial };
}

/**
 * Make an imported post show up like a Rankflow one: its focus keyword is a used, approved keyword,
 * and its title an approved topic linked to the article. Never touches keywords or topics the team made,
 * except to mark a matching keyword as used.
 */
export async function linkKeywordAndTopic(clientId: string, articleId: string, p: { keyword: string; title: string; when: Date }) {
  const keyword = p.keyword.trim().slice(0, 200);
  if (!keyword) return;
  const norm = normalizeKeyword(keyword);
  const existing = await db.keyword.findUnique({ where: { clientId_keywordNorm: { clientId, keywordNorm: norm } } });
  const kw = existing
    ? existing.used
      ? existing
      : await db.keyword.update({ where: { id: existing.id }, data: { used: true, usedAt: p.when, ...(existing.status === "PENDING" ? { status: "APPROVED" as const } : {}) } })
    : await db.keyword.create({ data: { clientId, keyword, keywordNorm: norm, status: "APPROVED", used: true, usedAt: p.when, source: "IMPORT", submittedBy: "WordPress", category: "From WordPress", addedAt: p.when } });
  const art = await db.article.findUnique({ where: { id: articleId }, select: { topicId: true } });
  if (art?.topicId) {
    // Keep the imported topic in step with WordPress (title or keyword changed there).
    await db.topic.updateMany({ where: { id: art.topicId, category: "From WordPress" }, data: { title: p.title, keyword, keywordId: kw.id } });
    return;
  }
  const topic = await db.topic.create({ data: { clientId, keywordId: kw.id, keyword, title: p.title, status: "APPROVED", category: "From WordPress", generatedAt: p.when } });
  await db.article.update({ where: { id: articleId }, data: { topicId: topic.id } });
}

/** One-off: give already imported articles their keyword and topic. Returns how many were linked. */
export async function backfillImported(clientId?: string) {
  const arts = await db.article.findMany({ where: { importedAt: { not: null }, topicId: null, OR: [{ wpType: null }, { wpType: "post" }], ...(clientId ? { clientId } : {}) }, select: { id: true, clientId: true, focusKeyword: true, wpTitle: true, metaTitle: true, wpType: true, pushedAt: true, importedAt: true } });
  let n = 0;
  for (const a of arts) {
    await linkKeywordAndTopic(a.clientId, a.id, { keyword: a.focusKeyword, title: a.wpTitle ?? a.metaTitle, when: a.pushedAt ?? a.importedAt! });
    n++;
  }
  return n;
}
