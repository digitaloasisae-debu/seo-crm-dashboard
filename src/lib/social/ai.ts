/**
 * Social Studio AI: service cards, the monthly idea plan (targeted services x proven angles),
 * captions per platform, and the per-project learning agent.
 */
import type { Client, SocialPost, SocialProject } from "@prisma/client";
import { db } from "../db";
import { geminiJson } from "../gemini";
import { brandProfileText } from "../brand-profile";
import { postingSlots } from "./schedule";

export const PLATFORMS = ["facebook", "instagram", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<Platform, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn" };

/** Proven post angles. Each idea uses one; layout = the image design used for it. */
export const ANGLES = [
  { key: "myth", label: "Myth bust", layout: "banner", hint: "Name a belief buyers of this service hold that is wrong, and show what is true instead." },
  { key: "mistake", label: "Costly mistake", layout: "banner", hint: "A specific mistake people make before or while buying this service, and what it costs them." },
  { key: "question", label: "Buyer question", layout: "split", hint: "A real question people ask before buying (cost, time, how to choose, is it worth it), answered straight." },
  { key: "versus", label: "This vs that", layout: "split", hint: "Compare two options the buyer is choosing between, and say who each one suits." },
  { key: "behind", label: "Behind the scenes", layout: "photo", hint: "How the work is really done: a step, a tool, a check most providers skip." },
  { key: "proof", label: "Proof", layout: "photo", hint: "A result, a before/after or a client situation, using only facts from the service card." },
  { key: "checklist", label: "Checklist", layout: "split", hint: "A short checklist or framework the reader will save (3-5 points)." },
  { key: "moment", label: "Local moment", layout: "banner", hint: "Tie the service to a real season, event or moment for this audience and location (e.g. a sale season, Ramadan, summer heat, year end, a holiday)." },
  { key: "opinion", label: "Bold opinion", layout: "statement", hint: "A confident, slightly contrarian take an expert in this service would defend." },
  { key: "offer", label: "Call to action", layout: "banner", hint: "A direct reason to get in touch now, without inventing discounts or prices." },
] as const;
export type AngleKey = (typeof ANGLES)[number]["key"];
export const angleOf = (k: string) => ANGLES.find((a) => a.key === k) ?? ANGLES[0];

const textModel = () => process.env.GEMINI_SOCIAL_MODEL || process.env.GEMINI_WRITER_MODEL || undefined;

const BANNED =
  "delve, unlock, elevate, game-changer, dive in, navigate, landscape, in today's fast-paced world, look no further, we are excited to announce, are you looking for, whether you are, seamless, cutting-edge, leverage, robust, unleash, empower, supercharge, journey, testament";

type ProjectWithClient = SocialProject & { client: Client };

const strip = (html: string) =>
  html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();

async function fetchHtml(url: string) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; RankflowBot/1.0)" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    return r.ok ? await r.text() : "";
  } catch {
    return "";
  }
}

/** The page on the client's site that is most about this service (by link text and URL). */
async function servicePage(siteUrl: string, service: string): Promise<{ url: string; text: string; home: string }> {
  const base = siteUrl.replace(/\/+$/, "");
  const html = await fetchHtml(base + "/");
  const words = service.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let best = { url: "", score: 0 };
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href = m[1];
    if (href.startsWith("/")) href = base + href;
    if (!href.startsWith(base)) continue;
    const hay = `${href} ${strip(m[2])}`.toLowerCase();
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > best.score) best = { url: href, score };
  }
  const page = best.url ? strip(await fetchHtml(best.url)).slice(0, 7000) : "";
  return { url: best.url, text: page, home: strip(html).slice(0, 4000) };
}

/** Draft the fact card for one targeted service from the website. */
export async function draftServiceCard(projectId: string, service: string) {
  const p = await db.socialProject.findUniqueOrThrow({ where: { id: projectId }, include: { client: { include: { brandProfile: true } } } });
  const site = await servicePage(p.client.siteUrl, service);
  const prompt = `You are preparing a social media strategist. Write a fact card about ONE service of this business, from its website text.
Only use facts that are on the website or the brand profile. Never invent prices, numbers, awards, client names or guarantees. If something is unknown, leave it out.

Business: ${p.client.name} (${p.client.businessType ?? "business"}), ${p.client.primaryCity ?? ""} ${p.client.targetCountry ?? ""}
Website: ${p.client.siteUrl}
Service: ${service}
${brandProfileText(p.client.brandProfile)}

SERVICE PAGE (${site.url || "not found"}):
${site.text || "(no dedicated page found)"}

HOME PAGE:
${site.home || "(could not load)"}

Return JSON: {"card":"markdown with these sections, short bullet points each: **What it is** / **Who buys it** (types of buyers, their situation) / **What they worry about** (5 fears or objections) / **Questions they ask before buying** (5) / **Proof we can use** (only real facts from the site) / **What makes us different** / **Link** (the best page URL for this service)"}`;
  const r = await geminiJson<{ card?: string }>(prompt, { timeoutMs: 90_000, temperature: 0.3, model: textModel() });
  const card = String(r.card ?? "").trim();
  await db.socialServiceCard.upsert({ where: { projectId_service: { projectId, service } }, create: { projectId, service, card }, update: { card } });
  return card;
}

/** Make sure every targeted service has a card (drafts the missing ones). */
export async function ensureServiceCards(projectId: string) {
  const p = await db.socialProject.findUniqueOrThrow({ where: { id: projectId }, include: { serviceCards: true } });
  const missing = p.services.filter((s) => !p.serviceCards.some((c) => c.service === s && c.card.trim()));
  for (const s of missing) await draftServiceCard(projectId, s).catch((e) => console.error("social.card_failed", s, e));
}

async function projectContext(projectId: string) {
  const p = await db.socialProject.findUniqueOrThrow({ where: { id: projectId }, include: { client: { include: { brandProfile: true } }, serviceCards: true } });
  const cards = p.services
    .map((s) => `### ${s}\n${p.serviceCards.find((c) => c.service === s)?.card || "(no card yet: stick to general, true statements about this service)"}`)
    .join("\n\n");
  const brand = brandProfileText(p.client.brandProfile);
  const brain = p.brain.trim() ? `## What Hamza has taught us for this account (follow these rules strictly)\n${p.brain}` : "";
  return { p, cards, brand, brain };
}

function businessLine(c: Client) {
  return `${c.name} (${c.businessType ?? "business"}), based in ${[c.primaryCity, c.targetCountry].filter(Boolean).join(", ") || "unknown"}. Website: ${c.siteUrl}`;
}

type PlannedIdea = { service: string; angle: string; idea: string; why: string; score: number };

/**
 * Plan a whole month for one project: fills the month up to postsPerMonth with new ideas,
 * spread over the targeted services and angles, each on its own posting date.
 * Returns how many posts were added.
 */
export async function planMonth(projectId: string, month: string): Promise<number> {
  await ensureServiceCards(projectId);
  const { p, cards, brand, brain } = await projectContext(projectId);
  if (!p.services.length) throw new Error(`${p.client.name}: add at least one targeted service first`);
  const existing = await db.socialPost.findMany({ where: { projectId, month, status: { not: "REJECTED" } }, select: { scheduledAt: true } });
  const need = p.postsPerMonth - existing.length;
  if (need <= 0) return 0;
  const slots = postingSlots({ month, count: need, postingDays: p.postingDays, fromHour: p.postFromHour, toHour: p.postToHour, timezone: p.timezone, notBefore: new Date(Date.now() + 2 * 3600_000), taken: existing.map((e) => e.scheduledAt), seed: projectId });
  if (!slots.length) throw new Error(`${p.client.name}: no posting days left in ${month}`);

  const since = new Date(Date.now() - 120 * 864e5);
  const [recent, rejected] = await Promise.all([
    db.socialPost.findMany({ where: { projectId, createdAt: { gte: since }, status: { not: "REJECTED" } }, select: { idea: true, service: true, angle: true }, orderBy: { createdAt: "desc" }, take: 80 }),
    db.socialPost.findMany({ where: { projectId, status: "REJECTED" }, select: { idea: true, rejectionReason: true }, orderBy: { reviewedAt: "desc" }, take: 30 }),
  ]);
  const want = slots.length + Math.min(8, Math.ceil(slots.length / 2));
  const prompt = `Plan ${want} social media post ideas for ${p.client.name}'s own accounts (${p.platforms.join(", ")}).

BUSINESS: ${businessLine(p.client)}

TARGETED SERVICES (every idea must be about exactly one of these, written exactly as here): ${p.services.join(" | ")}

SERVICE CARDS (facts you may use; never invent others):
${cards}

${brand}

${brain}

ANGLES (each idea uses one; use the key):
${ANGLES.map((a) => `- ${a.key}: ${a.label}. ${a.hint}`).join("\n")}

RULES
- An idea is one specific, concrete post, not a topic. Bad: "Benefits of SEO". Good: "Your Google Business Profile category is probably wrong, and it is costing you map calls".
- Think like the buyer scrolling a feed: a fear, a surprise, a mistake they might be making, a decision they are stuck on, a moment in their week or season.
- Spread ideas evenly across the services and use at least 6 different angles. At most 1 in 6 ideas may be the "offer" angle.
- Use the season of ${month} for the audience's country when it fits (events, weather, sale seasons, religious holidays, financial year), without forcing it.
- No invented numbers, prices, awards, client names or guarantees.
- Do not repeat or lightly reword these recent posts:
${recent.map((r) => `  - [${r.service} / ${r.angle}] ${r.idea}`).join("\n") || "  (none yet)"}
- Hamza rejected these, so avoid what made them weak:
${rejected.map((r) => `  - ${r.idea} -> reason: ${r.rejectionReason || "not given"}`).join("\n") || "  (none yet)"}

Score each idea 1-10 for: how hard the hook stops a scroll, how specific it is, how clearly it leads to buying the service, and how fresh it is.

Return JSON: {"ideas":[{"service":"exact service name","angle":"angle key","idea":"the post in one sentence, as specific as possible","why":"why this will work with this audience, 1 short sentence","score":8}]}`;
  const r = await geminiJson<{ ideas?: PlannedIdea[] }>(prompt, { timeoutMs: 180_000, temperature: 0.9, model: textModel() });
  const ideas = (r.ideas ?? [])
    .map((i) => ({ ...i, service: p.services.find((s) => s.toLowerCase() === String(i.service ?? "").toLowerCase()) ?? "", angle: angleOf(String(i.angle)).key, idea: String(i.idea ?? "").trim(), why: String(i.why ?? "").trim(), score: Math.max(1, Math.min(10, Number(i.score) || 5)) }))
    .filter((i) => i.service && i.idea);
  if (!ideas.length) throw new Error(`${p.client.name}: the AI returned no usable ideas, try again`);

  // Pick the best ideas while keeping services balanced and no angle overused.
  const picked: PlannedIdea[] = [];
  const pool = [...ideas].sort((a, b) => b.score - a.score);
  const perService = Math.ceil(slots.length / p.services.length);
  const perAngle = Math.max(2, Math.ceil(slots.length / 5));
  const count = (k: "service" | "angle", v: string) => picked.filter((x) => x[k] === v).length;
  for (const pass of [0, 1]) {
    for (const i of pool) {
      if (picked.length >= slots.length) break;
      if (picked.includes(i)) continue;
      if (pass === 0 && (count("service", i.service) >= perService || count("angle", i.angle) >= perAngle)) continue;
      picked.push(i);
    }
  }
  // Order so neighbouring posts differ in service and angle.
  const ordered: PlannedIdea[] = [];
  const left = [...picked];
  while (left.length) {
    const prev = ordered[ordered.length - 1];
    let idx = left.findIndex((x) => !prev || (x.service !== prev.service && x.angle !== prev.angle));
    if (idx < 0) idx = left.findIndex((x) => !prev || x.angle !== prev.angle);
    if (idx < 0) idx = 0;
    ordered.push(left.splice(idx, 1)[0]);
  }
  await db.socialPost.createMany({
    data: ordered.map((i, n) => ({ projectId, month, service: i.service, angle: i.angle, idea: i.idea, why: i.why, score: i.score, scheduledAt: slots[n], imageLayout: angleOf(i.angle).layout })),
  });
  return ordered.length;
}

/** One replacement idea for a rejected post (same date, same service), using what was just learned. */
export async function planReplacement(rejectedId: string) {
  const old = await db.socialPost.findUniqueOrThrow({ where: { id: rejectedId } });
  const { p, cards, brand, brain } = await projectContext(old.projectId);
  const prompt = `Hamza rejected this social post idea for ${p.client.name}: "${old.idea}" (angle: ${old.angle}). Reason: ${old.rejectionReason || "not given"}.
Write ONE better idea for the same service "${old.service}", taking the reason into account. Use a different angle unless the reason says the angle was fine.

BUSINESS: ${businessLine(p.client)}
SERVICE CARDS:
${cards}
${brand}
${brain}

ANGLES: ${ANGLES.map((a) => `${a.key} (${a.label})`).join(", ")}
No invented numbers, prices, awards or guarantees.
Return JSON: {"angle":"angle key","idea":"one specific sentence","why":"1 short sentence","score":8}`;
  const r = await geminiJson<Partial<PlannedIdea>>(prompt, { timeoutMs: 90_000, temperature: 0.9, model: textModel() });
  const angle = angleOf(String(r.angle)).key;
  return db.socialPost.create({
    data: { projectId: old.projectId, month: old.month, service: old.service, angle, idea: String(r.idea ?? old.idea), why: String(r.why ?? ""), score: Number(r.score) || 5, scheduledAt: old.scheduledAt, imageLayout: angleOf(angle).layout },
  });
}

type Written = {
  id: string;
  hooks?: string[];
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  firstComment?: string;
  altText?: string;
  headline?: { top?: string; main?: string; bottom?: string };
  imageBrief?: string;
};

/** Write hooks, captions, headline and image brief for up to ~4 posts of one project in one AI call. */
export async function writePosts(posts: SocialPost[]) {
  if (!posts.length) return;
  const { p, cards, brand, brain } = await projectContext(posts[0].projectId);
  const link = p.client.ctaLink || p.client.siteUrl;
  const on = (x: Platform) => p.platforms.includes(x);
  const system = `You are a top social media copywriter and art director. You write scroll-stopping posts that sound like a sharp, friendly human expert, never like a brochure or an AI.

VOICE
- Conversational and punchy. Short sentences. Talk to "you". Confident, a little bold, never corporate.
- Every line earns its place: a surprising, useful point, a relatable pain, a clear tip. No filler, no warm-up.
- Banned words and phrases: ${BANNED}. No em dashes. No "Did you know".
- Never invent statistics, prices, timelines, awards, reviews, client names or guarantees. Use only facts from the service card and brand profile.
- Keywords must read like natural English, with the small words a person would say ("SEO services in Dubai", not "seo services dubai").
- Spelling of the client's country.

HOOKS: write 3 different opening lines for the post (one sentence each, under 110 characters): a myth bust, a mistake callout, a curiosity gap, a painfully relatable moment, a bold opinion, or a direct question the buyer has really asked. Specific to this idea, never generic. Hamza picks one, so make all 3 strong and different.

CAPTIONS (start each with hooks[0], adapted to the platform):
${on("instagram") ? `- instagram: hook first (the first 125 characters decide everything). Then 3-6 very short lines of value, one idea per line with line breaks. 50-140 words. End with ONE action that earns saves or shares ("Save this for...", "Send this to someone who...") or a question to answer in the comments, then the call to action with "link in bio". Max 3 emojis used as markers. Blank line, then 3-5 specific hashtags (topic, niche, local).` : ""}
${on("facebook") ? `- facebook: hook, then 2-4 short lines that make people react or comment. Call to action with this link on its own line: ${link}. 0-2 emojis, 0-2 hashtags. Max about 500 characters.` : ""}
${on("linkedin") ? `- linkedin: first 2 lines must make people click "see more" (sharp observation, contrarian take or mini story). Then 60-130 words, one sentence per paragraph, lots of white space, one sharp insight or 3 short points. End with a genuine question, then the call to action. NO links in the post. 0-2 emojis, 3-4 hashtags at the end. Also write firstComment: one line with the link ${link}.` : ""}
Platforms not listed: return an empty string.

IMAGE (one designed image used on every platform: a real-looking photo with our headline set on top in code)
- headline: the text on the image. Never the keyword as a label. Turn the idea into something people stop for: a bold outcome, a warning, a twist, a sharp question. top = 1-4 words, main = the 1-3 word punch (shown biggest, in the brand colour), bottom = 1-5 words. Max 10 short words in total, reads as one line. No invented numbers.
- imageBrief: the photo only, described for a photographer: the real place, people, objects and action that show THIS idea's exact point, the season and location, the mood. No text, signs, screens with words, logos or UI in the photo. Prefer people, hands, objects and places over laptops and phones. Leave calm space ${"in the lower third"} for the headline. Photorealistic, natural light, real textures.
- altText: one sentence describing the image for screen readers.`;
  const prompt = `BUSINESS: ${businessLine(p.client)}
Main call to action: ${p.client.ctaText || "get in touch"} (${link})

SERVICE CARDS:
${cards}

${brand}

${brain}

POSTS TO WRITE:
${posts
  .map((x) => `- id ${x.id}: service "${x.service}", angle "${angleOf(x.angle).label}" (${angleOf(x.angle).hint}). Idea: ${x.idea}${x.textNote ? `\n  Hamza's note for this rewrite (most important): ${x.textNote}` : ""}${x.captionInstagram || x.captionFacebook || x.captionLinkedin ? `\n  Previous version (do better, don't copy): ${(x.captionLinkedin || x.captionInstagram || x.captionFacebook).slice(0, 500)}` : ""}`)
  .join("\n")}

Return JSON: {"posts":[{"id":"...","hooks":["","",""],"instagram":"","facebook":"","linkedin":"","firstComment":"","altText":"","headline":{"top":"","main":"","bottom":""},"imageBrief":""}]}`;
  const r = await geminiJson<{ posts?: Written[] }>(prompt, { system, timeoutMs: 200_000, temperature: 0.8, model: textModel() });
  const out = r.posts ?? [];
  const clean = (s: unknown, max: number) => String(s ?? "").replace(/—/g, ",").trim().slice(0, max);
  for (const x of posts) {
    const w = out.find((o) => o.id === x.id) ?? (out.length === posts.length ? out[posts.indexOf(x)] : undefined);
    if (!w) throw new Error("The AI skipped this post, it will be retried");
    await db.socialPost.update({
      where: { id: x.id },
      data: {
        hooks: (w.hooks ?? []).map((h) => clean(h, 200)).filter(Boolean).slice(0, 3),
        captionInstagram: on("instagram") ? clean(w.instagram, 2200) : "",
        captionFacebook: on("facebook") ? clean(w.facebook, 3000) : "",
        captionLinkedin: on("linkedin") ? clean(w.linkedin, 3000) : "",
        firstComment: on("linkedin") ? clean(w.firstComment, 500) : "",
        altText: clean(w.altText, 400),
        headlineTop: clean(w.headline?.top, 60),
        headlineMain: clean(w.headline?.main, 40),
        headlineBottom: clean(w.headline?.bottom, 60),
        imageBrief: clean(w.imageBrief, 1500),
        textNote: null,
      },
    });
  }
}

/**
 * The learning agent: reads this project's feedback (rejections with reasons, edits, regenerate
 * notes, approvals) and rewrites the project's rules. Every idea and caption prompt includes them.
 */
export async function updateBrain(projectId: string) {
  const p = await db.socialProject.findUniqueOrThrow({ where: { id: projectId }, include: { client: { select: { name: true } } } });
  const fb = await db.socialFeedback.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 60, include: { post: { select: { idea: true, angle: true, service: true } } } });
  if (!fb.length) return p.brain;
  const lines = fb.map((f) => {
    const post = f.post ? `[${f.post.service} / ${f.post.angle}] "${f.post.idea}"` : "";
    if (f.kind === "edit") return `- EDITED ${f.note} on ${post}\n  before: ${(f.before ?? "").slice(0, 400)}\n  after: ${(f.after ?? "").slice(0, 400)}`;
    return `- ${f.kind.toUpperCase()} ${post}${f.note ? ` -> "${f.note}"` : ""}`;
  });
  const prompt = `You are the learning agent for the social media account of ${p.client.name}. Hamza (the owner) reviews every post. Below is his feedback, newest first: rejections with reasons, notes when he asked for a rewrite or a new image, edits he made before approving, and approvals.

Turn it into a short list of clear rules the idea planner, copywriter and image designer must follow next time. Keep rules that still hold from the current list, merge duplicates, drop ones his newer feedback contradicts. Be specific ("Never open with a question on LinkedIn", "Images: no people in suits, show real shop floors"). Max 15 rules. Prefix each with [Ideas], [Captions] or [Images].

CURRENT RULES:
${p.brain || "(none yet)"}

FEEDBACK:
${lines.join("\n")}

Return JSON: {"rules":["[Captions] ...", "..."]}`;
  const r = await geminiJson<{ rules?: string[] }>(prompt, { timeoutMs: 90_000, temperature: 0.2, model: textModel() });
  const rules = (r.rules ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 15);
  if (!rules.length) return p.brain;
  const brain = rules.map((x) => `- ${x.replace(/^[-*]\s*/, "")}`).join("\n");
  await db.socialProject.update({ where: { id: projectId }, data: { brain, brainUpdatedAt: new Date() } });
  return brain;
}
