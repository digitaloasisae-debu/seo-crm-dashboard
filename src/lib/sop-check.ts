/**
 * Rule-based SOP checks for an article (everything that can be measured without AI).
 * Mirrors Hamza's SOP 1 (general) and SOP 2 (local, applied when the client has a primary city).
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

export function checkArticle(a: ArticleInput, c: ClientInput) {
  const root = parse(a.bodyHtml || "");
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
  const md = (a.metaDescription || "").trim();
  const mdStatus: CheckStatus = !md ? "fail" : md.length >= 150 && md.length <= 160 && hasKeyword(md, kw) ? "pass" : md.length >= 120 && md.length <= 175 ? "warn" : "fail";
  items.push(item("meta_desc", "Title & meta", "Meta description 150–160 characters with the keyword", mdStatus, md ? `${md.length} characters${hasKeyword(md, kw) ? "" : ", keyword missing"}` : "Missing"));
  const oldYears = [...new Set((`${a.metaTitle} ${text}`.match(/\b(2019|2020|2021|2022|2023|2024|2025)\b/g) ?? []))];
  items.push(item("year_rule", "Title & meta", "Uses 2026 as the current year (no 2024/2025)", oldYears.length === 0 ? "pass" : "warn", oldYears.length ? `Mentions ${oldYears.join(", ")}. Fine only if it's historical data.` : "No outdated years"));

  // --- Body ---
  items.push(item("word_count", "Content", "At least 1,000 words", wc >= 1000 ? "pass" : wc >= 800 ? "warn" : "fail", `${wc.toLocaleString()} words`, 2));
  const first100 = allWords.slice(0, 100).join(" ");
  items.push(item("kw_intro", "Content", "Primary keyword in the first 100 words", hasKeyword(first100, kw) ? "pass" : "fail", hasKeyword(first100, kw) ? "Found in the intro" : "Not in the first 100 words", 2));
  const kwLen = Math.max(1, words(kw).length);
  const density = wc ? (countPhrase(text, kw) * kwLen * 100) / wc : 0;
  items.push(item("kw_density", "Content", "Keyword density 1%–1.5%", band(Number(density.toFixed(2)), 1, 1.5, 0.6, 2.2), `${density.toFixed(2)}% (${countPhrase(text, kw)} uses)`));
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => words(s).length > 2);
  const longS = sentences.filter((s) => words(s).length > 22).length;
  const longShare = sentences.length ? longS / sentences.length : 0;
  items.push(item("sentences", "Content", "Short sentences (15–20 words)", longShare <= 0.15 ? "pass" : longShare <= 0.3 ? "warn" : "fail", `${Math.round(longShare * 100)}% of sentences are over 22 words`));
  const longP = paras.filter((p) => words(p).length > 100).length;
  items.push(item("paragraphs", "Content", "Short paragraphs (under 100 words)", longP === 0 ? "pass" : longP <= 2 ? "warn" : "fail", longP ? `${longP} paragraph${longP > 1 ? "s" : ""} over 100 words` : "All paragraphs are short"));
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
  items.push(item("external_links", "Links", "Exactly 1 external authority link", external.length === 1 ? "pass" : external.length === 2 || external.length === 0 ? "warn" : "fail", `${external.length} external links`));
  const notBlank = external.filter((l) => l.el.getAttribute("target") !== "_blank").length;
  if (external.length) items.push(item("external_blank", "Links", "External link opens in a new tab", notBlank ? "warn" : "pass", notBlank ? `${notBlank} external link${notBlank > 1 ? "s" : ""} without target="_blank"` : "Opens in new tab"));
  const compHosts = c.competitors.map((x) => host(x.startsWith("http") ? x : `https://${x}`)).filter(Boolean);
  const compLinks = external.filter((l) => compHosts.includes(host(l.href)));
  items.push(item("no_competitors", "Links", "Never links to competitors", compLinks.length ? "fail" : "pass", compLinks.length ? `Links to ${compLinks.map((l) => host(l.href)).join(", ")}` : "No competitor links", 1.5));

  // --- Images ---
  const imgs = root.querySelectorAll("img");
  const imgCount = imgs.length + (a.featuredImageUrl ? 1 : 0);
  const needImgs = Math.max(1, Math.floor(wc / 500));
  items.push(item("images", "Images", "At least 1 image per 500 words", imgCount >= needImgs ? "pass" : imgCount >= 1 ? "warn" : "fail", `${imgCount} image${imgCount === 1 ? "" : "s"} for ${wc} words (needs ${needImgs})`));
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
  const slugWords = a.slug.split("-").filter(Boolean);
  items.push(item("slug", "Structure", "Short, keyword-rich URL slug", a.slug.length <= 60 && slugWords.length <= 7 && hasKeyword(a.slug.replace(/-/g, " "), kw) ? "pass" : a.slug.length <= 75 ? "warn" : "fail", `/${a.slug}`));
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
