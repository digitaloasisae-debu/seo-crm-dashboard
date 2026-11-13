/**
 * Rule-based SOP checks for an article (everything that can be measured without AI).
 * Mirrors Hamza's SOP 1 (general, updated 12 Nov 2026 with the Blog Writing SOP) and SOP 2 (local, when the client has a primary city).
 */
import { parse, type HTMLElement } from "node-html-parser";

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckItem = { id: string; group: string; label: string; status: CheckStatus; detail: string; weight?: number };

export type ArticleInput = {
  metaTitle: string;
  metaDescription: string | null;
  slug: string;
  focusKeyword: string;
  bodyHtml: string;
  featuredImageUrl: string | null;
};
export type ClientInput = { siteUrl: string; primaryCity: string | null; competitors: string[]; ctaLink: string | null; ctaText: string | null; linkPool?: string[] };
/** SOP Step 1 research for the focus keyword (Rankflow's cached Google research), when there is one. */
export type ResearchInput = { secondary: string[]; paa: string[] } | null;

const STOP = new Set("a an the and or of to in on for with is are do does can how what when why which who your you my i it its be by at from vs".split(" "));
const content = (s: string) => words(s).filter((w) => !STOP.has(w) && w.length > 1);
/** A question "is used" when most of its meaningful words appear in the heading. */
function overlaps(heading: string, q: string) {
  const qw = content(q), hw = new Set(content(heading));
  if (!qw.length) return false;
  return qw.filter((w) => hw.has(w) || hw.has(w.replace(/s$/, ""))).length / qw.length >= 0.6;
}
const TRANSITIONS = ["however", "because", "for example", "for instance", "as a result", "therefore", "also", "in addition", "besides", "meanwhile", "instead", "although", "though", "while", "since", "so", "but", "first", "second", "third", "finally", "next", "then", "after", "before", "afterward", "similarly", "likewise", "in fact", "of course", "on the other hand", "in other words", "that said", "even so", "otherwise", "unless", "until", "once", "if", "consequently", "thus", "moreover", "furthermore", "overall", "in short", "to sum up", "for this reason", "as long as", "even if", "in particular", "especially", "above all", "most importantly", "at the same time", "in the meantime", "later", "now", "today", "still", "yet", "plus", "whereas", "rather", "such as", "like"];
const POWER = ["best", "ultimate", "proven", "easy", "simple", "quick", "fast", "essential", "complete", "expert", "top", "secret", "surprising", "smart", "guide", "free", "instant", "powerful", "effective", "genius", "must", "critical", "honest", "real", "warning", "costly", "cheap", "affordable", "biggest", "new", "amazing", "incredible", "step-by-step", "checklist", "tips", "signs", "mistakes", "ways", "reasons"];
const SENTIMENT = ["best", "worst", "amazing", "awful", "bad", "great", "good", "costly", "expensive", "cheap", "affordable", "avoid", "mistakes", "warning", "dangerous", "safe", "easy", "hard", "painful", "happy", "love", "hate", "fail", "failing", "broken", "proven", "surprising", "shocking", "simple", "stress-free", "hassle-free", "smart", "wrong", "right", "perfect", "ultimate", "essential", "risky", "free", "save", "saving", "problems", "signs", "trouble"];

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
const words = (s: string) => norm(s).split(/\s+/).filter(Boolean);
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

/** Keyword "appears" if the exact phrase is there, or (looser) all its words appear close together. */
function hasKeyword(text: string, kw: string) {
  const t = ` ${norm(text)} `, k = norm(kw);
  if (!k) return false;
  if (t.includes(` ${k} `)) return true;
  const kws = k.split(" ").filter((w) => w.length > 2);
  return kws.length > 0 && kws.every((w) => t.includes(` ${w}`));
}
function countPhrase(text: string, kw: string) {
  const t = ` ${norm(text)} `, k = ` ${norm(kw)} `;
  if (k.trim() === "") return 0;
  let n = 0, i = 0;
  while ((i = t.indexOf(k, i)) !== -1) { n++; i += k.length - 1; }
  return n;
}
function syllables(w: string) {
  w = w.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const m = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}
const item = (id: string, group: string, label: string, status: CheckStatus, detail: string, weight = 1): CheckItem => ({ id, group, label, status, detail, weight });
const band = (v: number, passLo: number, passHi: number, warnLo: number, warnHi: number): CheckStatus => (v >= passLo && v <= passHi ? "pass" : v >= warnLo && v <= warnHi ? "warn" : "fail");

/** WF2 puts a <style> block (brand colours) in the body: its CSS must not count as words. */
const stripCode = (html: string) => html.replace(/<(style|script|noscript)[\s\S]*?<\/\1>/gi, "");

export function checkArticle(a: ArticleInput, c: ClientInput, research: ResearchInput = null) {
  const root = parse(stripCode(a.bodyHtml || ""));
  const kw = a.focusKeyword || "";
  const text = root.structuredText.replace(/\s+/g, " ").trim();
  const allWords = words(text);
  const wc = allWords.length;
  const items: CheckItem[] = [];
  const h1El = root.querySelector("h1");
  const h1 = h1El?.textContent.trim() || a.metaTitle;
  const paras = root.querySelectorAll("p").map((p) => p.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
  const headings = root.querySelectorAll("h1,h2,h3,h4,h5,h6");
  const h2s = root.querySelectorAll("h2").map((h) => h.textContent.trim());

  // --- Title & meta ---
  items.push(item("h1_keyword", "Title & meta", "Primary keyword in the H1 title", hasKeyword(h1, kw) ? "pass" : "fail", `H1: "${h1}"`, 2));
  items.push(item("h1_length", "Title & meta", "H1 title under 60 characters", band(h1.length, 1, 60, 61, 70), `${h1.length} characters`));
  const mt = a.metaTitle.trim();
  items.push(item("meta_title", "Title & meta", "Meta title under 60 characters with the keyword", mt.length <= 60 && hasKeyword(mt, kw) ? "pass" : mt.length <= 70 ? "warn" : "fail", `${mt.length} characters${hasKeyword(mt, kw) ? "" : ", keyword missing"}`));
  const tw0 = words(mt || h1);
  const hasNum = /\d/.test(mt || h1);
  const hasPower = tw0.some((w) => POWER.includes(w));
  const hasSent = tw0.some((w) => SENTIMENT.includes(w));
  const got = [hasNum && "number", hasPower && "power word", hasSent && "sentiment word"].filter(Boolean) as string[];
  const missing = ["number", "power word", "sentiment word"].filter((x) => !got.includes(x));
  items.push(item("title_power", "Title & meta", "Title has a number, a power word and a sentiment word", missing.length === 0 ? "pass" : missing.length === 1 ? "warn" : "fail", missing.length ? `Missing: ${missing.join(", ")}` : "All three found"));
  const firstHalf = (mt || h1).slice(0, Math.ceil((mt || h1).length / 2) + norm(kw).length);
  items.push(item("title_kw_first", "Title & meta", "Primary keyword in the first half of the SEO title", hasKeyword(firstHalf, kw) ? "pass" : hasKeyword(mt || h1, kw) ? "warn" : "fail", hasKeyword(firstHalf, kw) ? "Yes" : "Keyword is late in the title or missing"));
  const md = (a.metaDescription || "").trim();
  const mdStatus: CheckStatus = !md ? "fail" : md.length >= 150 && md.length <= 160 && hasKeyword(md, kw) ? "pass" : md.length >= 120 && md.length <= 175 ? "warn" : "fail";
  items.push(item("meta_desc", "Title & meta", "Meta description 150–160 characters with the keyword", mdStatus, md ? `${md.length} characters${hasKeyword(md, kw) ? "" : ", keyword missing"}` : "Missing"));
  const oldYears = [...new Set((`${a.metaTitle} ${text}`.match(/\b(2019|2020|2021|2022|2023|2024|2025)\b/g) ?? []))];
  items.push(item("year_rule", "Title & meta", "Uses 2026 as the current year (older years only for comparisons)", oldYears.length === 0 ? "pass" : "warn", oldYears.length ? `Mentions ${oldYears.join(", ")}. Fine only if it's historical data.` : "No outdated years"));

  // --- Body ---
  items.push(item("word_count", "Content", "1,000–2,000 words (the brief's length)", wc >= 1000 && wc <= 2200 ? "pass" : wc >= 800 ? "warn" : "fail", `${wc.toLocaleString()} words`, 2));
  const first100 = allWords.slice(0, 100).join(" ");
  items.push(item("kw_intro", "Content", "Primary keyword in the first 100 words", hasKeyword(first100, kw) ? "pass" : "fail", hasKeyword(first100, kw) ? "Found in the intro" : "Not in the first 100 words", 2));
  const kwLen = Math.max(1, words(kw).length);
  const density = wc ? (countPhrase(text, kw) * kwLen * 100) / wc : 0;
  items.push(item("kw_density", "Content", "Keyword density 1%–1.5%", band(Number(density.toFixed(2)), 1, 1.5, 0.6, 2.2), `${density.toFixed(2)}% (${countPhrase(text, kw)} uses)`));
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => words(s).length > 2);
  // SOP: mix short and long sentences (no fixed length), and avoid rambling ones.
  const lens = sentences.map((x) => words(x).length);
  const shortShare = lens.length ? lens.filter((l) => l <= 12).length / lens.length : 0;
  const longShare = lens.length ? lens.filter((l) => l >= 20).length / lens.length : 0;
  const rambling = lens.filter((l) => l > 35).length;
  const mixed = shortShare >= 0.15 && longShare >= 0.15;
  items.push(item("sentences", "Content", "Mix of short and long sentences", mixed && rambling <= 2 ? "pass" : mixed || rambling <= 2 ? "warn" : "fail", `${Math.round(shortShare * 100)}% short, ${Math.round(longShare * 100)}% long${rambling ? `, ${rambling} over 35 words` : ""}`));
  // SOP (Yoast): transition words in at least 30% of sentences.
  const withTrans = sentences.filter((x) => { const t = ` ${norm(x)} `; return TRANSITIONS.some((w) => t.includes(` ${w} `)); }).length;
  const transShare = sentences.length ? withTrans / sentences.length : 0;
  items.push(item("transitions", "Content", "Transition words in at least 30% of sentences", transShare >= 0.3 ? "pass" : transShare >= 0.2 ? "warn" : "fail", `${Math.round(transShare * 100)}% of sentences`));
  // SOP: paragraphs at least 4–5 lines (about 50+ words), except the bold answer, lists and FAQ answers.
  const faqStart = root.querySelectorAll("h1,h2,h3,h4,h5,h6").find((h) => /faq|frequently asked/i.test(h.textContent));
  const bodyParas = root.querySelectorAll("p").filter((p) => {
    if (p.closest("li") || p.closest("table")) return false;
    if (faqStart && faqStart.range[0] < p.range[0]) return false;
    return !!p.textContent.trim();
  }).slice(1);
  const shortP = bodyParas.filter((p) => words(p.textContent).length < 50).length;
  const longP = root.querySelectorAll("p").filter((p) => words(p.textContent).length > 120).length;
  const badP = shortP + longP * 2;
  items.push(item("paragraphs", "Content", "Paragraphs 4–5 lines minimum and under 120 words (except the bold answer, lists and FAQ)", longP === 0 && shortP <= 1 ? "pass" : badP <= 3 ? "warn" : "fail", [shortP && `${shortP} under about 4 lines`, longP && `${longP} over 120 words`].filter(Boolean).join(", ") || "All paragraphs are the right length", 1.5));
  // SOP: bold 1–1.5 line direct answer right under the title.
  const firstP = root.querySelectorAll("p").find((p) => p.textContent.trim());
  const firstBold = firstP?.querySelector("strong, b");
  const boldWords = firstBold ? words(firstBold.textContent).length : 0;
  const startsBold = !!firstBold && norm(firstP!.textContent).startsWith(norm(firstBold.textContent).slice(0, 20));
  items.push(item("bold_answer", "Content", "Bold 1–1.5 line direct answer under the title", startsBold && boldWords >= 8 && boldWords <= 40 ? "pass" : firstBold ? "warn" : "fail", !firstBold ? "First paragraph has no bold answer" : !startsBold ? "Bold text isn't at the start of the first paragraph" : `${boldWords} words in bold`, 2));
  // SOP: no AI-sounding phrases.
  const AI_PHRASES = ["in today's fast-paced world", "in todays fast paced world", "delve into", "delves into", "it's important to note", "its important to note", "unlock", "elevate", "in conclusion", "not just", "game-changer", "game changer", "navigate the complexities", "in the ever-evolving", "look no further"];
  const low = ` ${text.toLowerCase()} `;
  const hits = [...new Set(AI_PHRASES.filter((ph) => low.includes(ph.replace(/[’]/g, "'"))))];
  items.push(item("ai_phrases", "Content", "No AI-sounding phrases", hits.length === 0 ? "pass" : hits.length <= 2 ? "warn" : "fail", hits.length ? `Found: ${hits.map((h) => `"${h}"`).join(", ")}` : "None found", 1.5));
  const lists = root.querySelectorAll("ul,ol").length;
  const tables = root.querySelectorAll("table").length;
  items.push(item("lists", "Content", "Bullet points or lists to break up text", lists >= 2 ? "pass" : lists === 1 ? "warn" : "fail", `${lists} list${lists === 1 ? "" : "s"}${tables ? `, ${tables} table${tables > 1 ? "s" : ""}` : ""}`));
  const totalSyl = allWords.reduce((n, w) => n + syllables(w), 0);
  const grade = sentences.length && wc ? 0.39 * (wc / sentences.length) + 11.8 * (totalSyl / wc) - 15.59 : 0;
  items.push(item("readability", "Content", "Readability grade 6–8", band(Math.round(grade), 5, 8, 4, 10), `Grade ${grade.toFixed(1)}`));

  // --- Headings ---
  items.push(item("h2_count", "Headings", "At least 3 H2 sections", h2s.length >= 3 ? "pass" : h2s.length >= 2 ? "warn" : "fail", `${h2s.length} H2 headings`));
  let skipped = 0, prev = 1;
  for (const h of headings) { const lvl = Number(h.tagName[1]); if (lvl > prev + 1) skipped++; prev = lvl; }
  items.push(item("hierarchy", "Headings", "Heading levels never skipped (H1 → H2 → H3)", skipped === 0 ? "pass" : "fail", skipped ? `${skipped} skipped level${skipped > 1 ? "s" : ""}` : "Clean hierarchy"));
  const multiH1 = root.querySelectorAll("h1").length;
  if (multiH1 > 1) items.push(item("one_h1", "Headings", "Only one H1", "fail", `${multiH1} H1 headings in the body`));

  // SOP Step 3: competitor keywords and People Also Ask questions in subheadings, the rest of PAA in the FAQ.
  if (research) {
    const faqAt = faqStart ? faqStart.range[0] : Infinity;
    const subs = root.querySelectorAll("h2,h3").filter((h) => h.range[0] < faqAt).map((h) => h.textContent.replace(/\s+/g, " ").trim());
    const sec = research.secondary.filter((k) => norm(k) !== norm(kw)).slice(0, 8);
    if (sec.length) {
      const used = sec.filter((k) => subs.some((h) => hasKeyword(h, k)));
      items.push(item("secondary_headings", "Headings", "3–5 competitor keywords used in subheadings", used.length >= Math.min(3, sec.length) ? "pass" : used.length >= 1 ? "warn" : "fail", used.length ? `Used: ${used.slice(0, 5).join(", ")}` : `None of: ${sec.slice(0, 5).join(", ")}`, 1.5));
    }
    if (research.paa.length) {
      const inHead = research.paa.filter((q) => subs.some((h) => overlaps(h, q)));
      // Same split as the research heading plan: some PAA in subheadings, keeping at least 5 for the FAQ.
      const n = research.paa.length;
      const need = Math.min(2, Math.min(4, Math.max(n >= 6 ? 2 : n >= 4 ? 1 : 0, n - 5)));
      if (need > 0) items.push(item("paa_headings", "Headings", "People Also Ask questions used as subheadings", inHead.length >= need ? "pass" : inHead.length ? "warn" : "fail", inHead.length ? `${inHead.length} of ${n} PAA questions` : "No PAA question in the H2/H3s", 1.5));
      const faqQs = faqStart ? root.querySelectorAll("h3,h4,strong,b").filter((h) => h.range[0] > faqAt && h.textContent.trim().endsWith("?")).map((h) => h.textContent.trim()) : [];
      const rest = research.paa.filter((q) => !inHead.includes(q));
      const inFaq = rest.filter((q) => faqQs.some((f) => overlaps(f, q)));
      if (rest.length) items.push(item("paa_faq", "Structure", "Remaining PAA questions used in the FAQ", inFaq.length >= Math.min(3, rest.length) ? "pass" : inFaq.length ? "warn" : "fail", `${inFaq.length} of ${rest.length} remaining PAA questions are in the FAQ`, 1.5));
    }
  }

  // --- Links ---
  const siteHost = host(c.siteUrl);
  const links = root.querySelectorAll("a[href]").map((el) => ({ el, href: el.getAttribute("href") || "", text: el.textContent.trim() }));
  const isInternal = (h: string) => h.startsWith("/") || h.startsWith("#") || (siteHost && host(h) === siteHost);
  const internal = links.filter((l) => isInternal(l.href) && !l.href.startsWith("#"));
  const external = links.filter((l) => /^https?:/i.test(l.href) && !isInternal(l.href));
  items.push(item("internal_links", "Links", "5–7 internal links", band(internal.length, 5, 7, 3, 10), `${internal.length} internal links`, 1.5));
  const introHtml = root.querySelector("p");
  const introHasLink = !!introHtml?.querySelectorAll("a[href]").some((x) => isInternal(x.getAttribute("href") || ""));
  items.push(item("intro_link", "Links", "First internal link in the intro paragraph", introHasLink ? "pass" : "warn", introHasLink ? "Intro has an internal link" : "No internal link in the first paragraph"));
  const badAnchors = internal.filter((l) => { const n = words(l.text).length; return n < 2 || n > 4; });
  items.push(item("anchors", "Links", "Internal anchor text is 2–3 words", internal.length === 0 ? "warn" : badAnchors.length === 0 ? "pass" : badAnchors.length <= 2 ? "warn" : "fail", badAnchors.length ? `${badAnchors.length} anchor${badAnchors.length > 1 ? "s" : ""} outside 2–3 words` : "Anchors look good"));
  const kwAnchors = internal.filter((l) => norm(l.text) === norm(kw) || (norm(kw).length > 3 && norm(l.text).includes(norm(kw)))).length;
  items.push(item("kw_anchor", "Links", "Primary keyword never used as anchor text", kwAnchors ? "fail" : "pass", kwAnchors ? `${kwAnchors} link${kwAnchors > 1 ? "s use" : " uses"} the focus keyword as anchor` : "Not used as an anchor"));
  items.push(item("external_links", "Links", "Exactly 1 external authority link", external.length === 1 ? "pass" : external.length === 2 || external.length === 0 ? "warn" : "fail", `${external.length} external links`));
  const notBlank = external.filter((l) => l.el.getAttribute("target") !== "_blank").length;
  if (external.length) items.push(item("external_blank", "Links", "External link opens in a new tab", notBlank ? "warn" : "pass", notBlank ? `${notBlank} external link${notBlank > 1 ? "s" : ""} without target="_blank"` : "Opens in new tab"));
  const compHosts = c.competitors.map((x) => host(x.startsWith("http") ? x : `https://${x}`)).filter(Boolean);
  const compLinks = external.filter((l) => compHosts.includes(host(l.href)));
  items.push(item("no_competitors", "Links", "Never links to competitors", compLinks.length ? "fail" : "pass", compLinks.length ? `Links to ${compLinks.map((l) => host(l.href)).join(", ")}` : "No competitor links", 1.5));

  // --- Images ---
  const imgs = root.querySelectorAll("img");
  const imgCount = imgs.length + (a.featuredImageUrl ? 1 : 0);
  const needImgs = Math.max(4, Math.floor(wc / 500));
  items.push(item("images", "Images", "At least 4 images, and 1 per 500 words", imgCount >= needImgs ? "pass" : imgCount >= 2 ? "warn" : "fail", `${imgCount} image${imgCount === 1 ? "" : "s"} for ${wc} words (needs ${needImgs})`));
  const noAlt = imgs.filter((i) => !(i.getAttribute("alt") || "").trim()).length;
  const kwAlt = imgs.some((i) => hasKeyword(i.getAttribute("alt") || "", kw));
  items.push(item("alt_text", "Images", "Alt text on every image, keyword in at least one", imgs.length === 0 ? "warn" : noAlt === 0 && kwAlt ? "pass" : noAlt === 0 ? "warn" : "fail", imgs.length === 0 ? "No images in the body" : `${noAlt} missing alt${kwAlt ? "" : ", no alt contains the keyword"}`));

  // --- FAQ & structure ---
  const faqHead = headings.find((h) => /faq|frequently asked/i.test(h.textContent));
  const questions = new Set<string>();
  if (faqHead) {
    const lvl = Number(faqHead.tagName[1]);
    let el = faqHead.nextElementSibling as HTMLElement | null;
    while (el && !(/^H[1-6]$/.test(el.tagName) && Number(el.tagName[1]) <= lvl)) {
      for (const q of [el, ...el.querySelectorAll("h3,h4,h5,h6,strong,b,dt,summary,p")]) {
        const t = q.textContent.replace(/\s+/g, " ").trim();
        if (t.endsWith("?") && t.length < 200) questions.add(norm(t));
      }
      el = el.nextElementSibling as HTMLElement | null;
    }
  }
  const faqCount = questions.size;
  items.push(item("faq", "Structure", "FAQ section with at least 5 questions", faqCount >= 5 ? "pass" : faqHead ? "warn" : "fail", faqHead ? `${faqCount} questions found` : "No FAQ section", 1.5));
  if (faqHead) {
    const h3q = new Set(root.querySelectorAll("h3").filter((h) => faqHead.range[0] < h.range[0] && h.textContent.trim().endsWith("?")).map((h) => norm(h.textContent)));
    items.push(item("faq_h3", "Structure", "FAQ questions written as H3 headings", faqCount && h3q.size >= Math.min(5, faqCount) ? "pass" : h3q.size ? "warn" : "fail", `${h3q.size} of ${faqCount} questions are H3`));
  }
  const slugWords = a.slug.split("-").filter(Boolean);
  const kwWords = content(kw);
  const extra = slugWords.filter((w) => !STOP.has(w) && !kwWords.includes(w) && !kwWords.includes(w.replace(/s$/, "")) && !kwWords.some((k) => k.replace(/s$/, "") === w));
  const fullUrl = `${c.siteUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${a.slug}/`;
  const slugYear = /\b20\d\d\b/.test(a.slug.replace(/-/g, " "));
  const slugProblems = [!hasKeyword(a.slug.replace(/-/g, " "), kw) && "keyword missing", extra.length > 0 && `extra words: ${extra.join(", ")}`, slugYear && "has a year", fullUrl.length >= 75 && `full URL ${fullUrl.length} characters`].filter(Boolean) as string[];
  items.push(item("slug", "Structure", "URL is only the primary keyword, full URL under 75 characters, no year", slugProblems.length === 0 ? "pass" : slugProblems.length === 1 && extra.length <= 2 ? "warn" : "fail", `/${a.slug}${slugProblems.length ? ` (${slugProblems.join("; ")})` : ""}`));
  const hasToc = /table of contents/i.test(text) || /(ez-toc|rank-math-toc|wp-block-yoast-seo-table-of-contents|lwptoc|toc_container|\[toc\])/i.test(a.bodyHtml);
  items.push(item("toc", "Structure", "Table of contents", hasToc ? "pass" : "warn", hasToc ? "Found" : "Not in the body. Fine if the site's TOC plugin adds it automatically."));
  const ctaHost = c.ctaLink ? c.ctaLink.replace(/\/$/, "") : "";
  const hasCta = (ctaHost && links.some((l) => l.href.replace(/\/$/, "") === ctaHost)) || (c.ctaText ? norm(text).includes(norm(c.ctaText)) : false) || /contact us|call us|book (a|your)|get (a|your) (free )?quote|schedule/i.test(text);
  items.push(item("cta", "Structure", "Natural call to action", hasCta ? "pass" : "warn", hasCta ? "CTA found" : "No clear CTA (contact link, button or phrase)"));

  // --- Local SEO (SOP 2) ---
  const city = c.primaryCity?.trim();
  if (city) {
    const lastText = paras.slice(-2).join(" ");
    const introText = paras.slice(0, 2).join(" ");
    items.push(item("local_title", "Local SEO", `City "${city}" and 2026 in the title`, hasKeyword(h1, city) && /2026/.test(h1) ? "pass" : hasKeyword(h1, city) ? "warn" : "fail", `H1: "${h1}"`, 1.5));
    items.push(item("local_intro", "Local SEO", "City named in the intro", hasKeyword(introText, city) ? "pass" : "fail", hasKeyword(introText, city) ? "Found" : "Not in the first paragraphs"));
    const h2City = h2s.filter((h) => hasKeyword(h, city)).length;
    items.push(item("local_h2", "Local SEO", "City named in H2 headings", h2City >= 1 ? "pass" : "fail", `${h2City} of ${h2s.length} H2s mention ${city}`));
    items.push(item("local_conclusion", "Local SEO", "City named in the conclusion / CTA", hasKeyword(lastText, city) ? "pass" : "warn", hasKeyword(lastText, city) ? "Found" : "Conclusion doesn't name the city"));
  }

  const value = { pass: 1, warn: 0.5, fail: 0 } as const;
  const tw = items.reduce((n, i) => n + (i.weight ?? 1), 0);
  const score = Math.round((items.reduce((n, i) => n + value[i.status] * (i.weight ?? 1), 0) / tw) * 100);
  return { score, wordCount: wc, items, local: !!city };
}
