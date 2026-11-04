/**
 * AI rewrites inside the dashboard: "Rewrite with these changes" and "Give me 3 title options".
 * Uses the client's brain, the SOP and the notes on the article. The old version is kept as an ArticleRevision.
 */
import { db } from "./db";
import { geminiJson } from "./gemini";
import { getSop } from "./sop";
import { toSafeHtml } from "./content";
import { runQuality, type QualityReport } from "./quality";
import { logActivity } from "./activity";

/** A rewrite that has been "running" this long has died (the server stops background work after 5 minutes). */
export const REVISE_STALE_MS = 6 * 60_000;

const writerModel = () => process.env.GEMINI_WRITER_MODEL || undefined;

const SYSTEM = `You are the senior SEO editor at a content agency. You revise an existing blog article for a client.
Apply EVERY change the team asks for. Keep everything they did not ask to change (facts, structure, links, keyword placement) unless it breaks the SOP.
Follow the agency SOP and the client's brain rules. Never invent facts about the business (prices, years, awards, addresses).
The body is HTML. Keep using simple HTML: h2, h3, p, ul, ol, li, table, a, strong, em, blockquote.
Images are shown as placeholders like [[IMG1]]. Keep each placeholder on its own line, exactly as written, unless the team asks to remove or move that image.
If the team gives a new image URL, add it as <img src="URL" alt="descriptive alt text with the keyword where natural">.
Return JSON: {"meta_title":"...","meta_description":"...","body_html":"...","changes":["<one short line per change you made>"]}`;

function pack(html: string) {
  const styles: string[] = [];
  const images: string[] = [];
  let body = html.replace(/<style[\s\S]*?<\/style>/gi, (m) => { styles.push(m); return ""; });
  // WF2 wraps the article in <div class="blog-content">; keep the wrapper out of the AI's hands.
  const wrap = body.match(/^\s*<div class="blog-content"[^>]*>([\s\S]*)<\/div>\s*$/i);
  if (wrap) body = wrap[1];
  body = body.replace(/<figure[\s\S]*?<\/figure>|<img[^>]*>/gi, (m) => { images.push(m); return `\n[[IMG${images.length}]]\n`; });
  return { body: body.trim(), styles, images, wrapped: !!wrap };
}

function unpack(body: string, p: ReturnType<typeof pack>) {
  let out = body.replace(/(?:<p>\s*)?\[\[IMG(\d+)\]\](?:\s*<\/p>)?/g, (_m, n) => p.images[Number(n) - 1] ?? "");
  if (p.wrapped) out = `<div class="blog-content">${out}</div>`;
  return toSafeHtml({ html: p.styles.join("\n") + out });
}

async function context(articleId: string) {
  const article = await db.article.findUniqueOrThrow({
    where: { id: articleId },
    include: {
      client: { select: { name: true, businessType: true, primaryCity: true, siteUrl: true, ctaText: true, ctaLink: true, brain: true } },
      topic: { select: { title: true, angle: true } },
      notes: { where: { appliedAt: null }, orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
    },
  });
  const sop = await getSop();
  const c = article.client;
  const head = `SOP:\n${sop}\n\nCLIENT: ${c.name}${c.businessType ? ` (${c.businessType})` : ""}${c.primaryCity ? `, local client in ${c.primaryCity}` : ""}${c.siteUrl ? `, site ${c.siteUrl}` : ""}${c.ctaText ? `\nCTA: ${c.ctaText}${c.ctaLink ? ` -> ${c.ctaLink}` : ""}` : ""}
CLIENT BRAIN (rules the team taught for this client, follow them strictly):\n${c.brain?.rules || "(none yet)"}

TOPIC: ${article.topic.title}${article.topic.angle ? `\nANGLE: ${article.topic.angle}` : ""}
FOCUS KEYWORD: ${article.focusKeyword}`;
  return { article, head };
}

const noteLine = (n: { kind: string; quote: string | null; body: string; author: { name: string } | null }) =>
  `- [${n.kind.toLowerCase()}${n.author ? `, ${n.author.name}` : ""}] ${n.quote ? `About "${n.quote.slice(0, 300)}": ` : ""}${n.body}`;

/** Rewrites the article with the given instructions plus its unapplied notes. Runs in the background. */
export async function reviseArticle(articleId: string, opts: { instructions: string; userId: string }) {
  try {
    const { article, head } = await context(articleId);
    const asks = [opts.instructions.trim() && `- ${opts.instructions.trim()}`, ...article.notes.map(noteLine)].filter(Boolean).join("\n");
    if (!asks) throw new Error("Nothing to change: write what you want changed, or add a note first");
    const quality = article.qualityReport as unknown as QualityReport | null;
    const fixes = [
      ...(quality?.items ?? []).filter((i) => i.status === "fail").map((i) => `${i.label}${i.detail ? ` (${i.detail})` : ""}`),
      ...(quality?.ai?.topFixes ?? []),
    ].slice(0, 12);
    const p = pack(article.bodyHtml);

    const out = await geminiJson<{ meta_title?: string; meta_description?: string; body_html?: string; changes?: string[] }>(
      `${head}

CHANGES THE TEAM WANTS (most important):
${asks}
${fixes.length ? `\nSOP CHECKER ISSUES (fix these too if you can without breaking the team's changes):\n${fixes.map((f) => `- ${f}`).join("\n")}\n` : ""}
CURRENT ARTICLE
Meta title: ${article.metaTitle}
Meta description: ${article.metaDescription ?? ""}
Body:
${p.body}`,
      { system: SYSTEM, timeoutMs: 270_000, model: writerModel(), temperature: 0.5 },
    );
    const body = (out.body_html ?? "").trim();
    if (body.length < Math.min(400, p.body.length / 3)) throw new Error("The AI returned an article that is far too short, so nothing was changed. Try again.");

    await db.$transaction([
      db.articleRevision.create({
        data: { articleId, metaTitle: article.metaTitle, metaDescription: article.metaDescription, bodyHtml: article.bodyHtml, request: asks, changes: (out.changes ?? []).slice(0, 20).map(String), createdById: opts.userId },
      }),
      db.article.update({
        where: { id: articleId },
        data: {
          metaTitle: out.meta_title?.trim() || article.metaTitle,
          metaDescription: out.meta_description?.trim() || article.metaDescription,
          bodyHtml: unpack(body, p),
          revisingAt: null,
          reviseError: null,
          // A rewritten article needs a fresh approval.
          ...(article.status === "APPROVED" || article.status === "CHANGES_REQUESTED" ? { status: "READY_FOR_REVIEW", approvedById: null, approvedAt: null } : {}),
        },
      }),
      db.articleNote.updateMany({ where: { id: { in: article.notes.map((n) => n.id) } }, data: { appliedAt: new Date() } }),
    ]);
    await logActivity({ actorId: opts.userId, clientId: article.clientId, action: "article.rewrite", entity: "article", entityId: articleId, after: { changes: out.changes?.length ?? 0 } });
    await runQuality(articleId).catch(() => null);
  } catch (e) {
    await db.article.update({ where: { id: articleId }, data: { revisingAt: null, reviseError: e instanceof Error ? e.message : String(e) } });
  }
}

export type TitleOption = { title: string; description: string; why: string };

/** Three alternative meta title + description pairs. */
export async function suggestTitles(articleId: string, hint: string): Promise<TitleOption[]> {
  const { article, head } = await context(articleId);
  const titleNotes = article.notes.filter((n) => n.kind === "TITLE").map(noteLine).join("\n");
  const out = await geminiJson<{ options?: { title?: string; description?: string; why?: string }[] }>(
    `${head}

Write 3 clearly different meta title + meta description options for this article.
Titles: 50-60 characters, focus keyword near the start, compelling, no clickbait. Descriptions: 140-160 characters with the keyword and a reason to click.
${hint.trim() || titleNotes ? `What the team wants:\n${hint.trim() ? `- ${hint.trim()}\n` : ""}${titleNotes}` : ""}

Current title: ${article.metaTitle}
Current description: ${article.metaDescription ?? ""}
Opening of the article:
${article.bodyHtml.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2500)}

Return JSON: {"options":[{"title":"...","description":"...","why":"<5-10 words on the angle>"}]}`,
    { temperature: 0.9, timeoutMs: 45_000 },
  );
  return (out.options ?? []).filter((o) => o.title).slice(0, 3).map((o) => ({ title: o.title!.trim(), description: (o.description ?? "").trim(), why: (o.why ?? "").trim() }));
}

// ---------- SOP auto-fix: check → fix → check again ----------

const FIX_SYSTEM = `You are the agency's SEO editor doing the final SOP pass on a blog draft before human review.
You get the SOP, the client's brain rules, and a list of SOP checker issues. Fix EVERY issue you can, and change nothing else:
keep the facts, voice, structure and the parts that already pass. Never invent facts about the business (prices, years in business, awards, addresses, phone numbers).
Typical fixes: put the focus keyword in the H1/title and first 100 words, adjust keyword density, shorten long sentences and paragraphs, add bullet lists,
add missing H2s, fix heading levels, write a 150–160 character meta description and a meta title under 60 characters (both with the keyword, and the city for local clients),
add or complete an FAQ section (at least 5 distinct questions), add a local CTA, name the city in the intro/H2s/conclusion, replace outdated years with 2026.
"To check" (WARN) items count too: fix them as well, not only the FAIL ones.
Local clients: write the location in "City, State/Province" form (e.g. "Lahore, Punjab", "Austin, TX") at least once in the title, the intro, one H2 and the conclusion.
Links: add internal links ONLY to URLs from the "INTERNAL PAGES" list (descriptive 2–3 word anchors, first one in the intro). Add at most one external link, only to a well-known authority site (government, standards body, major publication), with target="_blank" rel="noopener".
The body is HTML. Images are placeholders like [[IMG1]]: keep each one on its own line, exactly as written.
The focus keyword must appear word for word in the FIRST paragraph (within the first 100 words of the body, after the H1).
Return JSON: {"meta_title":"...","meta_description":"...","body_html":"...","image_alts":{"IMG1":"..."},"changes":["<one short line per fix>"]}`;

/** Checker items the AI can't fix in text (images, the URL slug). */
const NOT_FIXABLE = new Set(["images", "slug"]);

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? "";
const escAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function setAlt(html: string, alt: string) {
  // Works for a bare <img> and for a <figure> holding one.
  return html.replace(/<img\b[^>]*>/i, (img) => (/\salt\s*=/i.test(img) ? img.replace(/\salt\s*=\s*"[^"]*"/i, ` alt="${escAttr(alt)}"`) : img.replace(/<img\b/i, `<img alt="${escAttr(alt)}"`)));
}

/** Code-level fix: every image gets an alt, and at least one alt holds the focus keyword. */
function ensureAlts(html: string, keyword: string, altMap?: Record<string, string>) {
  const p = pack(html);
  if (!p.images.length) return html;
  const before = [...p.images];
  p.images = p.images.map((img, n) => {
    const given = altMap?.[`IMG${n + 1}`]?.trim();
    if (given) return setAlt(img, given.slice(0, 150));
    return attr(img.match(/<img\b[^>]*>/i)?.[0] ?? "", "alt").trim() ? img : setAlt(img, keyword);
  });
  const kw = keyword.trim();
  const altOf = (img: string) => attr(img.match(/<img\b[^>]*>/i)?.[0] ?? "", "alt");
  if (kw && !p.images.some((img) => altOf(img).toLowerCase().includes(kw.toLowerCase()))) {
    const old = altOf(p.images[0]);
    p.images[0] = setAlt(p.images[0], old && old !== kw ? `${kw.charAt(0).toUpperCase()}${kw.slice(1)}: ${old}`.slice(0, 150) : kw);
  }
  if (p.images.every((img, i) => img === before[i])) return html;
  return unpack(p.body.replace(/\n?\[\[IMG(\d+)\]\]\n?/g, "[[IMG$1]]"), p);
}

/** Fewer problems = better. The AI review's own score wobbles a little between runs, so count issues instead. */
const issueCount = (r: QualityReport) => [...r.items, ...(r.ai?.items ?? [])].reduce((n, i) => n + (i.status === "fail" ? 1 : i.status === "warn" ? 0.5 : 0), 0);

/**
 * The SOP pass every new draft gets: full SOP check (rules + AI review), AI fixes what failed,
 * then the check runs again. If the fix doesn't raise the score, the original is kept.
 */
export async function autoFixSop(articleId: string, opts: { userId?: string; minScore?: number } = {}) {
  const target = opts.minScore ?? 95;
  const before = await runQuality(articleId, { ai: true });
  const issues = [
    ...before.report.items.filter((i) => i.status !== "pass" && !NOT_FIXABLE.has(i.id)).map((i) => `${i.status.toUpperCase()}: ${i.label}${i.detail ? ` (${i.detail})` : ""}`),
    ...(before.report.ai?.items ?? []).filter((i) => i.status !== "pass").map((i) => `${i.status.toUpperCase()}: ${i.label}${i.detail ? ` (${i.detail})` : ""}`),
    ...(before.report.ai?.topFixes ?? []).map((f) => `FIX: ${f}`),
  ];
  const mark = (note: string) => db.article.update({ where: { id: articleId }, data: { sopFixFrom: before.score, sopFixAt: new Date(), sopFixNote: note, revisingAt: null } });
  if (before.score >= target || issues.length === 0) {
    await mark(before.score >= target ? "Already met the SOP" : "Nothing the AI can fix");
    return { before: before.score, after: before.score, fixed: false };
  }

  await db.article.update({ where: { id: articleId }, data: { revisingAt: new Date(), reviseError: null } });
  try {
    const { article, head } = await context(articleId);
    const untouched = { metaTitle: article.metaTitle, metaDescription: article.metaDescription, bodyHtml: article.bodyHtml };
    // Step 0, no AI needed: alt text.
    const withAlts = ensureAlts(article.bodyHtml, article.focusKeyword);
    if (withAlts !== article.bodyHtml) {
      await db.article.update({ where: { id: articleId }, data: { bodyHtml: withAlts } });
      article.bodyHtml = withAlts;
    }
    const client = await db.client.findUniqueOrThrow({ where: { id: article.clientId }, select: { linkPool: true, siteUrl: true, gscPages: { select: { page: true }, orderBy: { clicks: "desc" }, take: 30 } } });
    const pages = [...new Set([...client.linkPool, ...client.gscPages.map((p) => p.page)])].filter((u) => /^https?:\/\//.test(u) || u.startsWith("/")).slice(0, 40);
    const p = pack(article.bodyHtml);
    const out = await geminiJson<{ meta_title?: string; meta_description?: string; body_html?: string; image_alts?: Record<string, string>; changes?: string[] }>(
      `${head}

SOP CHECKER ISSUES TO FIX (score ${before.score}/100):
${issues.slice(0, 40).map((i) => `- ${i}`).join("\n")}

IMAGES (write alt text for each: descriptive, under 125 characters, and the focus keyword in at least the first one):
${p.images.length ? p.images.map((img, n) => `- IMG${n + 1}: current alt "${attr(img.match(/<img\b[^>]*>/i)?.[0] ?? "", "alt")}"`).join("\n") : "(none)"}

INTERNAL PAGES (the only URLs you may link internally):
${pages.length ? pages.map((u) => `- ${u}`).join("\n") : "(none known: do not add internal links)"}

CURRENT ARTICLE
Meta title: ${article.metaTitle}
Meta description: ${article.metaDescription ?? ""}
Body:
${p.body}`,
      { system: FIX_SYSTEM, timeoutMs: 200_000, model: writerModel(), temperature: 0.3 },
    );
    let body = (out.body_html ?? "").trim();
    // The fix must not lose images: put any dropped placeholder back before the last H2.
    const missing = p.images.map((_, n) => `[[IMG${n + 1}]]`).filter((ph) => !body.includes(ph));
    if (missing.length) {
      const at = body.toLowerCase().lastIndexOf("<h2");
      const block = `\n${missing.join("\n")}\n`;
      body = at > 0 ? body.slice(0, at) + block + body.slice(at) : body + block;
    }
    if (body.length < p.body.length * 0.6) throw new Error("The fixed draft came back much shorter, so the original was kept");

    const original = { metaTitle: article.metaTitle, metaDescription: article.metaDescription, bodyHtml: article.bodyHtml };
    await db.article.update({
      where: { id: articleId },
      data: { metaTitle: out.meta_title?.trim() || article.metaTitle, metaDescription: out.meta_description?.trim() || article.metaDescription, bodyHtml: ensureAlts(unpack(body, p), article.focusKeyword, out.image_alts) },
    });
    const after = await runQuality(articleId, { ai: true });
    const better = after.report.ruleScore >= before.report.ruleScore && (issueCount(after.report) < issueCount(before.report) || after.score > before.score);
    if (!better) {
      // Keep the draft as it was (plus the alt-text fix, which only helps).
      await db.article.update({ where: { id: articleId }, data: original });
      const kept = await runQuality(articleId);
      if (original.bodyHtml !== untouched.bodyHtml) await db.articleRevision.create({ data: { articleId, ...untouched, request: "- SOP auto-fix: image alt text", changes: ["Added alt text with the focus keyword"], createdById: opts.userId ?? null } });
      await mark(original.bodyHtml !== untouched.bodyHtml ? "Fixed the image alt text. The AI's other changes didn't reduce the issues, so they weren't kept" : "The AI's changes didn't reduce the issues, so the draft was kept as it was");
      return { before: before.score, after: kept.score, fixed: original.bodyHtml !== untouched.bodyHtml };
    }
    await db.articleRevision.create({
      data: { articleId, ...untouched, request: `- SOP auto-fix (score ${before.score} → ${after.score})`, changes: (out.changes ?? []).slice(0, 25).map(String), createdById: opts.userId ?? null },
    });
    await mark(`Fixed ${out.changes?.length ?? 0} issue${out.changes?.length === 1 ? "" : "s"}`);
    await logActivity({ actorId: opts.userId, actorTag: opts.userId ? undefined : "sop-autofix", clientId: article.clientId, action: "article.sop_fix", entity: "article", entityId: articleId, after: { before: before.score, after: after.score } });
    return { before: before.score, after: after.score, fixed: true };
  } catch (e) {
    await db.article.update({ where: { id: articleId }, data: { revisingAt: null, sopFixFrom: before.score, sopFixAt: new Date(), sopFixNote: null, reviseError: `SOP auto-fix: ${e instanceof Error ? e.message : String(e)}` } });
    return { before: before.score, after: before.score, fixed: false };
  }
}
