import { db } from "./db";

/** Default SOP, from Hamza (2026-11-03). Super Admin can override it in the app (AppSetting "sop"). */
export const DEFAULT_SOP = `SEO Content Writing SOPs

SOP 1 — General SEO Content Writing Process
Follow this process for every piece of content, start to finish.

1. Pre-Writing: Research & Planning
- Primary Keyword: pick one main focus keyword
- Secondary Keywords: list 3–5 related (LSI) keywords
- Search Intent: confirm it matches informational, transactional, navigational, or commercial intent
- Word Count: standard blogs = 1,000–1,200 words; pillar/comparison = 1,500+ words
- Content Brief: outline with H1/H2/H3, pick a content angle (guide, listicle, how-to, review)
- Add AT LEAST 5 distinct FAQs from "People Also Ask" + competitor pages
- Define clear CTAs (e.g. "Contact us," "Shop now")

2. Writing: Title, Headings & Meta
- H1 Title: primary keyword included naturally, under 60 characters
- Current Year Rule: Always use 2026 as the current year for temporal statements, titles, or current guide recommendations. Never use past years like 2024 or 2025 unless referencing historical data.
- Use H2/H3 subheadings with secondary/LSI keywords in logical order (never skip levels)
- Meta Title: under 60 characters, includes main keyword
- Meta Description: 150–160 characters, engaging, includes primary keyword

3. Writing: Content Body
- Primary keyword MUST appear in the first 100 words of the opening paragraph
- Keyword density 1%–1.5% — natural, never stuffed
- Short sentences (15–20 words max) and short paragraphs (2–3 lines / under 100 words)
- Use bullet points, lists, and visuals to break up text
- Match or exceed target word count (1,000–1,200 words minimum)
- Content must be original, actionable, and solve the reader's problem

Linking Rules
- Internal links: 5–7 per post, place the first link in the intro paragraph, 2–3 word anchor text
- External links: Exactly 1 to a high-authority pre-approved source (DA 50+), opens in new tab, never link competitors

4. On-Page SEO Checks
- At least 1 image per 500 words with keyword-optimized alt text
- Optimize for featured snippets (lists, tables, Q&A format)
- Include an FAQ section with AT LEAST 5 Q&A pairs
- Short, descriptive, keyword-rich URL slug
- Natural CTA (form, button, or link)

5. Post-Writing Checklist
- Grammarly score 90+ (no grammar issues)
- 100% unique — checked with Copyscape/Quetext
- Readability at Grade 6–8 (Hemingway/Yoast standard)
- Proper heading hierarchy: H1 → H2 → H3
- Keywords used naturally, no stuffing
- Internal & external links inserted correctly
- Alt text added on all images
- Word count matches the brief (1,000–1,200+ words)

SOP 2 — Local SEO Blog Rules
Apply these rules on top of SOP 1 for every blog written for a local or service-area client.

1. Keyword & Topic Selection
- 1 primary keyword + 2–3 supporting local keywords
- Topic must tie to a current trend (seasonal demand, viral DIY fails, rising energy costs) or a frequently searched local problem

2. Local Optimization (Required on Every Post)
- Include primary city + "city, state" naturally in the title, intro, H2s, and conclusion
- Use hyper-local phrasing: "homeowners in [City]," "[City] HVAC codes," "common [City] plumbing issues"
- Reference local landmarks, climate, or regulations where it fits naturally

3. Blog Structure
- Title — primary keyword + city + 2026 (e.g. "Best Water Heater Upgrades for [City] Homeowners in 2026")
- Intro (100–150 words) — hook + primary keyword in first 100 words + local context
- H2 sections (3–5) — each targeting a supporting keyword or question
- FAQ Section — minimum 5 local/service FAQs
- Local CTA — ends with a call to action naming the city and service

4. Style & Consistency
- Tone: conversational but professional — no jargon, no fluff
- Length: 1,000–1,200 words for standard posts; 1,500+ for pillar posts
- No walls of text — short paragraphs, H2/H3 subheadings, plain bullet lists`;

export async function getSop() {
  const row = await db.appSetting.findUnique({ where: { key: "sop" } });
  return row?.value?.trim() ? row.value : DEFAULT_SOP;
}
