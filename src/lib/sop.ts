import { db } from "./db";

/** Default SOP, from Hamza (2026-11-03). Super Admin can override it in the app (AppSetting "sop"). */
export const DEFAULT_SOP = `SEO Content Writing SOPs
Updated 12 Nov 2026 (Blog Writing SOP of 11 Nov merged in; where an older rule clashed, the newer rule replaced it).

Purpose
Every blog must answer its title directly, rank for the keywords competitors already rank for, and read like a person wrote it. SOP 1 applies to every blog for every client, from research to publishing. SOP 2 adds rules for local and service-area clients. Follow the steps in order and complete the final checklist before a blog goes live.

SOP 1 — General SEO Content Writing Process

Step 1: Research before writing
No writing starts until this research is done and saved with the brief.
1. Search the focus keyword on Google (incognito, target location set) and note the top results.
2. Pick 3–4 competitor articles that rank on page one for the focus keyword. Skip directories, forums and marketplaces.
3. Review each competitor article: its headings, the topics it covers, what it answers well and what it misses.
4. List the keywords competitors rank for (Ahrefs, Semrush or Ubersuggest on each competitor URL). Pick 3–5 of them as the blog's secondary keywords.
5. Copy the People Also Ask (PAA) questions for the focus keyword. Expand a few to load more.
6. Confirm the search intent (informational, transactional, navigational or commercial) and pick a content angle that fits it (guide, how-to, comparison, cost breakdown, checklist, myths vs facts).
7. Save the brief: focus keyword, secondary keywords, PAA questions, competitor URLs with notes, outline (H1/H2/H3), angle, CTA, and word count (standard blog 1,000–1,200 words; pillar or comparison 1,500+).
The goal is to cover everything the top competitors cover, plus what they miss, without drifting off the title.

Step 2: Title, meta and the direct answer
- H1 title: primary keyword included naturally, under 60 characters.
- Meta title: under 60 characters, includes the primary keyword.
- Meta description: 150–160 characters, engaging, includes the primary keyword.
- URL slug: short, descriptive, includes the keyword.
- Current year: use 2026 wherever a year appears (title, intro, prices, stats). Never leave last year's date in. Earlier years are allowed only when comparing with or citing past data.
- Direct answer first: the first line under the title answers the title's question or promise, in bold, in 1–1.5 lines. The rest of the paragraph, and the rest of the blog, explains it.
- The primary keyword appears in the first 100 words.
- Stay on the title: every section must help answer it. If a topic doesn't, cut it, even if a competitor covers it.
Example. Title: How Often Should You Clean Your Air Ducts?
**Most homes should have their air ducts cleaned every 3 to 5 years, or sooner with pets, smokers or recent renovations.** The right schedule depends on…

Step 3: Headings and keywords
- Primary (focus) keyword: in the title, H1 and main H2 headings, written naturally.
- Secondary keywords (from competitors): in H2 and H3 subheadings, one main keyword per heading.
- People Also Ask questions: use some as H2/H3 subheadings (the question or its keywords). The rest go in the FAQ (Step 6).
- Heading order is H1 → H2 → H3. Never skip a level. Only one H1.
- Headings must read naturally. Never stuff keywords or repeat the same phrase in every heading.
- Keyword density 1%–1.5% across the body, never stuffed.

Step 4: Writing style
The blog must read like an experienced person wrote it, not an AI tool.
Paragraphs
- Every paragraph is at least 4–5 lines long. No one- or two-line paragraphs.
- Exceptions: the bold answer under the title, bullet lists, and FAQ answers.
- Break up the text with H2/H3 subheadings, bullet lists, tables and visuals, not with very short paragraphs.
Natural, human tone
- Mix short and long sentences. Don't start sentences the same way.
- Write the way the client would explain it to a customer: plain words, real examples, local details. Conversational but professional, no jargon or fluff.
- Remove AI-sounding phrases such as "In today's fast-paced world", "delve into", "it's important to note", "unlock", "elevate" and "in conclusion".
- Avoid rhythm patterns AI overuses: "not just X, but Y", lists of three in every sentence, and dramatic one-line closers.
- Read the blog out loud and rewrite any sentence that sounds stiff or robotic.
- Readability around grade 6–8.
Every blog must feel different
- Don't reuse the same structure for every blog (intro → 5 tips → conclusion every time).
- Vary the opening after the bold answer: a question, a customer scenario, a stat, a common mistake.
- Choose the format that suits the topic: steps, comparisons, cost breakdowns, checklists, myths vs facts.
- Before writing, check the client's last 3 blogs and make sure the new one doesn't follow the same pattern.
Content
- Original, actionable, and solves the reader's problem. Match or exceed the word count in the brief.
- Optimise for featured snippets with lists, tables and clear question-and-answer blocks.

Step 5: Links, images and CTA
- Internal links: 5–7 per post. The first one is in the intro paragraph. Anchor text is 2–3 words.
- External links: exactly 1, to a high-authority pre-approved source (DA 50+), opening in a new tab. Never link to competitors.
- Images: at least 1 per 500 words, with descriptive alt text on every image and the keyword in at least one.
- A natural call to action (form, button or link), e.g. "Contact us".

Step 6: FAQ section
Every blog ends with an FAQ section built from the People Also Ask questions.
- At least 5 questions, using the PAA questions from Step 1 that weren't already used as subheadings (add competitor-page questions only if PAA runs short).
- Write each question exactly as people search it, as an H3.
- Answer in the first sentence, then add 2–3 sentences of detail.
- Every FAQ relates to the blog title.

Step 7: Final checklist
Tick every item before the blog goes live.
[ ] 3–4 competitor articles reviewed and saved in the brief
[ ] Competitor keywords used as secondary keywords in subheadings
[ ] PAA questions used in subheadings, the rest in the FAQ
[ ] Primary keyword in the title, H1, main headings and first 100 words
[ ] Meta title, meta description and slug follow Step 2
[ ] Bold, 1–1.5 line answer right under the title
[ ] All content stays relevant to the title
[ ] Every paragraph is at least 4–5 lines (except the bold answer, lists and FAQ answers)
[ ] Reads naturally, with no AI-sounding phrases or repeated sentence patterns
[ ] Structure and opening differ from the client's last 3 blogs
[ ] Heading order H1 → H2 → H3, no skipped levels
[ ] 5–7 internal links, 1 external authority link, no competitor links
[ ] Images with alt text (1 per 500 words)
[ ] FAQ section with at least 5 questions from the remaining PAA questions
[ ] Current year (2026) used everywhere, earlier years only for comparisons or past data
[ ] Grammar clean (Grammarly 90+) and 100% unique (Copyscape or Quetext)
[ ] Word count matches the brief

SOP 2 — Local SEO Blog Rules
Apply these on top of SOP 1 for every blog for a local or service-area client. Anything not listed here follows SOP 1.

1. Keywords and topic
- 1 primary keyword plus 2–3 supporting local keywords (these count toward the secondary keywords in SOP 1).
- The topic ties to a current trend (seasonal demand, viral DIY fails, rising energy costs) or a frequently searched local problem.

2. Local optimisation (required on every post)
- Include the primary city, or "city, state", naturally in the title, intro, H2s and conclusion.
- Use hyper-local phrasing: "homeowners in [City]", "[City] HVAC codes", "common [City] plumbing issues".
- Reference local landmarks, climate or regulations where it fits naturally.

3. Structure
- Title: primary keyword + city + 2026 (e.g. "Best Water Heater Upgrades for [City] Homeowners in 2026").
- Intro: the bold direct answer first (SOP 1, Step 2), then local context, within the first 100–150 words.
- H2 sections (3–5), each targeting a supporting keyword or PAA question.
- FAQ: at least 5 local or service questions (SOP 1, Step 6).
- End with a local CTA naming the city and the service.`;

export async function getSop() {
  const row = await db.appSetting.findUnique({ where: { key: "sop" } });
  return row?.value?.trim() ? row.value : DEFAULT_SOP;
}
