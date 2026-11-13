import { db } from "./db";

/** Default SOP, from Hamza (updated 2026-11-12, "SEO Content Writing SOPs" PDF). Super Admin can override it in the app (AppSetting "sop"). */
export const DEFAULT_SOP = `SEO Content Writing SOPs
Updated 12 Nov 2026 by Hamza.

Purpose
Every blog must answer its title directly, rank for the keywords competitors already rank for, score 95+ in Rank Math, and read like a person wrote it. SOP 1 applies to every blog for every client, from research to publishing. SOP 2 adds rules for local and service-area clients. Where an older rule clashed with a newer one, the newer rule is the one kept here.

SOP 1: General SEO content writing process

Step 1: Research before writing
No writing starts until this research is done and saved with the brief.
1. Search the focus keyword on Google (incognito, target location set) and note the top results.
2. Pick 3–4 competitor articles ranking on page one. Skip directories, forums and marketplaces.
3. Review each competitor article: its headings, topics covered, what it answers well and what it misses.
4. List the keywords competitors rank for (Ahrefs, Semrush or Ubersuggest on each URL). Pick 3–5 as the blog's secondary keywords.
5. Copy the People Also Ask (PAA) questions for the focus keyword. Expand a few to load more.
6. Confirm the search intent (informational, transactional, navigational or commercial) and choose an angle that fits: guide, how-to, comparison, cost breakdown, checklist, or myths vs facts.
7. Check the focus keyword isn't already used as the focus keyword on another post on the site.
8. Save the brief: focus keyword, secondary keywords, PAA questions, competitor URLs with notes, outline (H1/H2/H3), angle, CTA and word count (1,000–2,000 words).
The goal is to cover everything the top competitors cover, plus what they miss, without drifting off the title.

Step 2: Title, meta, URL and the direct answer
Title and meta
- H1 / SEO title: under 60 characters, primary keyword in the first half, plus a number, a power word and a positive or negative sentiment word.
- Meta description: 150–160 characters, engaging, primary keyword included.
- URL (slug): only the primary keyword, never the blog title. Full URL including the domain under 75 characters, no years or filler words. Example: title "How Often Should You Clean Your Air Ducts? 7 Signs It's Time" → /how-often-to-clean-air-ducts/.
- Current year: use 2026 wherever a year appears (title, intro, prices, stats). Earlier years only when comparing with or citing past data.
The direct answer
- The first line under the title answers the title's question or promise, in bold, in 1–1.5 lines.
- The rest of the paragraph, and the rest of the blog, explains that answer.
- The primary keyword appears in the first 100 words.
Example. Title: How Often Should You Clean Your Air Ducts?
"**Most homes should have their air ducts cleaned every 3 to 5 years, or sooner with pets, smokers or recent renovations.** The right schedule depends on…"
Stay on the title. Every section must help answer it. If a topic doesn't, cut it, even if a competitor covers it.

Step 3: Headings and keywords
- Primary (focus) keyword: title, H1 and main H2 headings, written naturally.
- Secondary keywords (from competitors): H2 and H3 subheadings, one main keyword per heading.
- People Also Ask questions: H2 and H3 subheadings, the question or its keywords as a subheading.
- Remaining PAA questions: FAQ section (see Step 6).
- Heading order is H1 → H2 → H3. Never skip a level. Only one H1.
- Keyword density 1–1.5% across the body (Rank Math warns above 2.5%).
- Headings must read naturally. Never stuff keywords or repeat the same phrase in every heading.

Step 4: Writing style
The blog must read like an experienced person wrote it, not an AI tool.
Paragraphs
- Every paragraph is at least 4–5 lines long and no more than 120 words. No one- or two-line paragraphs.
- Exceptions: the bold answer under the title, bullet lists and FAQ answers.
- Break up text with subheadings, bullet lists, tables and visuals, not with very short paragraphs.
Natural, human tone
- Mix short and long sentences. Don't start sentences the same way.
- Write the way the client would explain it to a customer: plain words, real examples, local details. Conversational but professional, no jargon or fluff.
- Use transition words (however, because, for example, as a result) in at least 30% of sentences.
- Remove AI-sounding phrases such as "In today's fast-paced world", "delve into", "it's important to note", "unlock", "elevate" and "in conclusion".
- Avoid patterns AI overuses: "not just X, but Y", lists of three in every sentence, and dramatic one-line closers.
- Readability around grade 6–8. Read the blog out loud and rewrite anything stiff.
Every blog must feel different
- Don't reuse the same structure every time (intro → 5 tips → conclusion).
- Vary the opening after the bold answer: a question, a customer scenario, a stat, a common mistake.
- Choose the format that suits the topic: steps, comparisons, cost breakdowns, checklists, myths vs facts.
- Check the client's last 3 blogs first and make sure the new one doesn't follow the same pattern.
Content
- Original, actionable and solves the reader's problem. Match or exceed the brief's word count.
- Optimise for featured snippets with lists, tables and clear question-and-answer blocks.

Step 5: Links, images and CTA
Internal links
- 5–7 internal links per post.
- The first one goes in the first paragraph and points to the client's main service page.
- Anchor text is 2–3 words.
- Never use the primary (focus) keyword as anchor text. Secondary keywords can be used as anchors.
External links
- Exactly 1 external link, dofollow, to a high-authority pre-approved source (DA 50+), opening in a new tab.
- Never link to competitors.
Images
- At least 4 images, and at least 1 per 500 words.
- Descriptive alt text on every image, with the primary keyword in at least one.
- Add a table of contents using a supported TOC plugin or block.
Call to action
- End with a natural CTA (form, button or link), e.g. "Contact us".

Step 6: FAQ section
Every blog ends with an FAQ section built from the People Also Ask questions.
- At least 5 questions, using the PAA questions not already used as subheadings (add competitor-page questions only if PAA runs short).
- Write each question exactly as people search it, as an H3.
- Answer in the first sentence, then add 2–3 sentences of detail.
- Every FAQ relates to the blog title.

Step 7: Rank Math and Yoast scores
No blog is published until Rank Math scores 95 or higher and Yoast shows green on both the SEO and Readability tabs. Check whichever plugin the site uses; if both are installed, both must pass. Most tests are covered by Steps 2–5; this is the quick reference.
Rank Math
- Focus keywords: enter the primary keyword first, then the secondary keywords.
- SEO title: primary keyword in the first half, plus a number, a power word and a sentiment word.
- Meta description: primary keyword within the first 120–160 characters.
- Opening: primary keyword in the first 10% of the content.
- Subheadings: primary and secondary keywords in H2/H3 headings.
- Keyword density: 1–1.5%; warning above 2.5%.
- Content length: keep to the brief's 1,000–2,000 words. Rank Math gives full marks only at 2,500+, so make up the points by passing every other test.
- Images: primary keyword in at least one alt text; 4+ images or videos.
- Paragraphs: none over 120 words.
- Table of contents: added with a supported TOC plugin or block.
- Links: internal links plus 1 dofollow external link.
- Keyword uniqueness: focus keyword not used on another post.
Yoast
- Enter the focus keyphrase in Yoast too. If it's empty, the SEO tab stays red.
- Transition words in at least 30% of sentences.
- Fix every red and orange item in both tabs.
Hit the scores without keyword stuffing. If a sentence reads badly after adding a keyword, rewrite it rather than forcing the keyword in.

Step 8: Pre-publish checks
- Grammar: Grammarly score 90+.
- Originality: 100% unique in Copyscape or Quetext.
- Year check: search the post for old years and update them to 2026 (except comparisons or past data).
- Links: every internal and external link opens the right page.

Step 9: Final checklist
Tick every item before the blog goes live.
[ ] 3–4 competitor articles reviewed and saved in the brief
[ ] 3–5 competitor keywords used as secondary keywords in subheadings
[ ] PAA questions used in subheadings, the rest in the FAQ
[ ] Primary keyword in the title, H1, main headings and first 100 words
[ ] Title under 60 characters with a number, power word and sentiment word
[ ] Meta description 150–160 characters with the primary keyword
[ ] URL contains only the primary keyword, not the blog title, under 75 characters
[ ] Bold, 1–1.5 line answer right under the title
[ ] All content stays relevant to the title
[ ] Every paragraph is 4–5 lines minimum and under 120 words (except the bold answer, lists and FAQ answers)
[ ] Reads naturally, with no AI-sounding phrases or repeated sentence patterns
[ ] Structure and opening differ from the client's last 3 blogs
[ ] Heading order H1 → H2 → H3, no skipped levels
[ ] First paragraph links to the main service page
[ ] 5–7 internal links; primary keyword never used as an anchor
[ ] 1 dofollow external authority link, no competitor links
[ ] At least 4 images (1 per 500 words), alt text on all
[ ] Table of contents added
[ ] FAQ section with at least 5 questions
[ ] Current year (2026) used everywhere, earlier years only for comparisons or past data
[ ] Rank Math score 95+
[ ] Yoast focus keyphrase set, SEO and Readability both green
[ ] Grammarly 90+ and 100% unique (Copyscape or Quetext)
[ ] Word count matches the brief

SOP 2: Local SEO blog rules
Apply these on top of SOP 1 for every blog for a local or service-area client. Anything not listed here follows SOP 1.

1. Keywords and topic
- 1 primary keyword plus 2–3 supporting local keywords (these count toward the secondary keywords in SOP 1).
- The topic ties to a current trend (seasonal demand, viral DIY fails, rising energy costs) or a frequently searched local problem.

2. Local optimisation (required on every post)
- Include the primary city, or "city, state", naturally in the title, intro, H2s and conclusion.
- Use hyper-local phrasing: "homeowners in [City]", "[City] HVAC codes", "common [City] plumbing issues".
- Reference local landmarks, climate or regulations where it fits naturally.

3. Structure
- Title: primary keyword + city + 2026, still under 60 characters (e.g. "Best Water Heater Upgrades for [City] Homes in 2026").
- URL: the primary keyword only, following SOP 1 Step 2.
- Intro: the bold direct answer first (SOP 1, Step 2), then local context within the first 100–150 words. The first paragraph links to the main service page.
- H2 sections (3–5), each targeting a supporting keyword or PAA question.
- FAQ: at least 5 local or service questions (SOP 1, Step 6).
- End with a local CTA naming the city and the service.`;

export async function getSop() {
  const row = await db.appSetting.findUnique({ where: { key: "sop" } });
  return row?.value?.trim() ? row.value : DEFAULT_SOP;
}
