/**
 * Social Studio AI: service cards, the monthly idea plan (targeted services x proven angles),
 * captions per platform, and the per-project learning agent.
 */
import type { Client, Prisma, SocialPost, SocialProject } from "@prisma/client";
import { db } from "../db";
import { geminiJson } from "../gemini";
import { brandProfileText } from "../brand-profile";
import { toLocalInput, weeklySlots, zoned } from "./schedule";
import { ensureResearch, researchText } from "./research";
import { buildCaption, cardUrl, titleLine, type CaptionParts } from "./caption";
import { PICTURE_FORMATS, PILLARS, WEEK_MIX, designOf, formatOf, pillarOf, type DesignData, type Slide } from "./formats";

export const PLATFORMS = ["facebook", "instagram", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<Platform, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn" };

/** Proven post angles. Each idea uses one; layout = the image format it starts with (the copywriter may pick another). */
export const ANGLES = [
  { key: "myth", label: "Myth bust", layout: "concept", hint: "Name a belief buyers of this service hold that is wrong, and show what is true instead." },
  { key: "mistake", label: "Costly mistake", layout: "concept", hint: "A specific mistake people make before or while buying this service, and what it costs them." },
  { key: "question", label: "Buyer question", layout: "concept", hint: "A real question people ask before buying (cost, time, how to choose, is it worth it), answered straight." },
  { key: "versus", label: "This vs that", layout: "concept", hint: "Compare two options the buyer is choosing between, and say who each one suits." },
  { key: "behind", label: "Behind the scenes", layout: "photo", hint: "How the work is really done: a step, a tool, a check most providers skip." },
  { key: "proof", label: "Proof", layout: "photo", hint: "A result, a before/after or a client situation, using only facts from the service card." },
  { key: "checklist", label: "Checklist", layout: "type", hint: "A short checklist of signs the reader needs this service, or of what the service covers (3-5 points)." },
  { key: "moment", label: "Local moment", layout: "concept", hint: "Tie the service to a real season, event or moment for this audience and location (e.g. a sale season, Ramadan, summer heat, year end, a holiday)." },
  { key: "opinion", label: "Bold opinion", layout: "type", hint: "A confident, slightly contrarian take an expert in this service would defend." },
  { key: "offer", label: "Call to action", layout: "concept", hint: "A direct reason to get in touch now, without inventing discounts or prices." },
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
async function servicePage(siteUrl: string, service: string, known: string[] = []): Promise<{ url: string; text: string; home: string }> {
  const base = siteUrl.replace(/\/+$/, "");
  const html = await fetchHtml(base + "/");
  const words = service.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let best = { url: "", score: 0 };
  // Links on the home page, plus pages we already know on the site (link pool, Search Console).
  const links = [...[...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => [m[1], m[2]]), ...known.map((u) => [u, ""])];
  for (const m of links) {
    let href = m[0];
    if (href.startsWith("/")) href = base + href;
    const bare = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
    if (!bare(href).startsWith(bare(base))) continue;
    const hay = `${href.replace(/[-_/]/g, " ")} ${strip(m[1])}`.toLowerCase();
    // A dedicated service page beats a blog post or a menu link that only shares a word.
    const score = words.filter((w) => hay.includes(w)).length + (/\/(services?|solutions?)\//i.test(href) ? 0.5 : 0) - (/\/(blog|category|tag)\//i.test(href) ? 0.5 : 0);
    if (score >= 1 && score > best.score) best = { url: href, score };
  }
  const page = best.url ? strip(await fetchHtml(best.url)).slice(0, 7000) : "";
  return { url: best.url, text: page, home: strip(html).slice(0, 4000) };
}

/** Draft the fact card for one targeted service from the website. */
export async function draftServiceCard(projectId: string, service: string) {
  const p = await db.socialProject.findUniqueOrThrow({ where: { id: projectId }, include: { client: { include: { brandProfile: true } } } });
  p.client.name = brandName(p.client.name);
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
  const url = site.url || cardUrl({ card }, p.client.siteUrl);
  await db.socialServiceCard.upsert({ where: { projectId_service: { projectId, service } }, create: { projectId, service, card, url }, update: { card, url } });
  return card;
}

/** Make sure every targeted service has a card (drafts the missing ones). */
export async function ensureServiceCards(projectId: string) {
  const p = await db.socialProject.findUniqueOrThrow({ where: { id: projectId }, include: { serviceCards: true } });
  const missing = p.services.filter((s) => !p.serviceCards.some((c) => c.service === s && c.card.trim()));
  for (const s of missing) await draftServiceCard(projectId, s).catch((e) => console.error("social.card_failed", s, e));
}

/**
 * The brand as people say it: "Digital Oasis AE" -> "Digital Oasis". Hamza (2026-11-17): no country or
 * city tags like "AE" in content. Only a trailing place tag is dropped, never the whole name.
 */
export function brandName(name: string) {
  const geo = /[\s,|·-]+(AE|UAE|KSA|SA|UK|US|USA|PK|Dubai|Abu Dhabi|Sharjah|Ajman|Riyadh|Doha|Qatar|Pakistan|Karachi|Lahore)\.?$/i;
  let out = name.trim();
  for (let i = 0; i < 2; i++) {
    const next = out.replace(geo, "").trim();
    if (!next || next === out) break;
    out = next;
  }
  return out || name;
}

async function projectContext(projectId: string) {
  const p = await db.socialProject.findUniqueOrThrow({ where: { id: projectId }, include: { client: { include: { brandProfile: true } }, serviceCards: true } });
  p.client.name = brandName(p.client.name);
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

type PlannedIdea = { slot: number; service: string; angle: string; idea: string; why: string; score: number };
type MonthEvent = { date: string; name: string; why: string };

/**
 * National holidays, observances and big events in `month` that this audience cares about, with their
 * dates in the country. Hamza approves every post, so a wrong date is caught in review.
 */
async function monthEvents(c: Client, month: string): Promise<MonthEvent[]> {
  const country = c.targetCountry || "United Arab Emirates";
  const prompt = `List the national holidays, public observances and big shared moments in ${country} during ${month} (YYYY-MM) that a ${c.businessType ?? "local business"} could post about on social media (for example national day, religious holidays and their eves, Mother's Day, back to school, White Friday / Black Friday, Dubai Shopping Festival, New Year, Earth Hour). Include international days only if people in ${country} really mark them and they fit this business.
Give the date as it is observed in ${country} in that year. For moon-sighted holidays give the expected first day. Leave out anything you are not sure falls in ${month}.
Return JSON: {"events":[{"date":"YYYY-MM-DD","name":"short name","why":"why this business can post about it, one short line"}]} (at most 6, most important first).`;
  try {
    const r = await geminiJson<{ events?: MonthEvent[] }>(prompt, { timeoutMs: 60_000, temperature: 0.1, model: textModel() });
    return (r.events ?? []).filter((e) => String(e.date ?? "").startsWith(month) && e.name).map((e) => ({ date: String(e.date).slice(0, 10), name: String(e.name).slice(0, 80), why: String(e.why ?? "").slice(0, 200) }));
  } catch (e) {
    console.error("social.events_failed", e);
    return [];
  }
}

/** Spread pillars over `n` posts by their share, so no pillar sits twice in a row when it can be helped. */
function pillarPlan(n: number, seed: number): string[] {
  const parts = PILLARS.filter((x) => x.share > 0);
  const exact = parts.map((x) => ({ key: x.key, v: x.share * n }));
  const counts = exact.map((x) => ({ key: x.key, n: Math.floor(x.v), r: x.v - Math.floor(x.v) }));
  let left = n - counts.reduce((a, x) => a + x.n, 0);
  for (const x of [...counts].sort((a, b) => b.r - a.r)) if (left-- > 0) x.n++;
  const out: string[] = [];
  let s = seed;
  while (out.length < n) {
    const avail = counts.filter((x) => x.n > 0).sort((a, b) => b.n - a.n || ((s = (s * 9301 + 49297) % 233280) / 233280) - 0.5);
    const pick = avail.find((x) => x.key !== out[out.length - 1]) ?? avail[0];
    out.push(pick.key);
    pick.n--;
  }
  return out;
}

/**
 * Plan a whole month for one project, Monday to Saturday (never Sunday): every week gets the
 * WEEK_MIX of formats (1 carousel, 2 Reels, 2 images). The posts are balanced over the content
 * PILLARS (informative, hidden promo, client journey, promotional), and holidays and events go out
 * on their real date. Days that already have a post are kept (the month is only topped up).
 * Returns how many posts were added.
 */
export async function planMonth(projectId: string, month: string): Promise<number> {
  await ensureServiceCards(projectId);
  await ensureResearch(projectId);
  const { p, cards, brand, brain } = await projectContext(projectId);
  const research = researchText(p.research, "ideas");
  if (!p.services.length) throw new Error(`${p.client.name}: add at least one targeted service first`);
  const existing = await db.socialPost.findMany({ where: { projectId, month, status: { not: "REJECTED" } }, select: { scheduledAt: true, pillar: true } });
  const skipDays = new Set(existing.map((e) => toLocalInput(e.scheduledAt, p.timezone).slice(0, 10)));
  const notBefore = new Date(Date.now() + 2 * 3600_000);
  const slots = weeklySlots({ month, fromHour: p.postFromHour, toHour: p.postToHour, timezone: p.timezone, notBefore, skipDays, seed: projectId, mix: WEEK_MIX });
  if (!slots.length) return 0;

  // Holidays and events: move the nearest post of that week onto the day (Sunday events go out on Saturday).
  const events = await monthEvents(p.client, month);
  const eventOf = new Map<number, MonthEvent>();
  const hadEvent = existing.filter((e) => e.pillar === "event").length;
  for (const ev of events.slice(0, Math.max(0, 4 - hadEvent))) {
    let day = new Date(`${ev.date}T00:00:00Z`);
    if (day.getUTCDay() === 0) day = new Date(day.getTime() - 864e5);
    const key = day.toISOString().slice(0, 10);
    if (!key.startsWith(month) || skipDays.has(key)) continue;
    const at = zoned(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.min(p.postFromHour + 1, p.postToHour), 0, p.timezone);
    if (at <= notBefore) continue;
    const same = slots.findIndex((x) => x.day === key);
    let i = same;
    if (i < 0) {
      // The closest free slot within 3 days.
      let best = -1;
      let gap = 4 * 864e5;
      slots.forEach((x, n) => {
        const g = Math.abs(new Date(`${x.day}T00:00:00Z`).getTime() - day.getTime());
        if (!eventOf.has(n) && g < gap && !slots.some((y) => y.day === key)) { best = n; gap = g; }
      });
      i = best;
      if (i < 0) continue;
      slots[i] = { ...slots[i], day: key, at };
    }
    if (eventOf.has(i)) continue;
    eventOf.set(i, ev);
  }
  slots.sort((a, b) => a.at.getTime() - b.at.getTime());
  // Re-key events after sorting.
  const evByDay = new Map([...eventOf.values()].map((ev) => {
    let d = new Date(`${ev.date}T00:00:00Z`);
    if (d.getUTCDay() === 0) d = new Date(d.getTime() - 864e5);
    return [d.toISOString().slice(0, 10), ev] as const;
  }));
  const regular = slots.filter((x) => !evByDay.has(x.day)).length;
  const pillars = pillarPlan(regular, [...projectId].reduce((a, ch) => a + ch.charCodeAt(0), 0) + Number(month.replace("-", "")));
  let pi = 0;
  const plan = slots.map((x) => {
    const ev = evByDay.get(x.day);
    return { ...x, pillar: ev ? "event" : pillars[pi++], event: ev };
  });

  const since = new Date(Date.now() - 120 * 864e5);
  const [recent, rejected] = await Promise.all([
    db.socialPost.findMany({ where: { projectId, createdAt: { gte: since }, status: { not: "REJECTED" } }, select: { idea: true, service: true, angle: true }, orderBy: { createdAt: "desc" }, take: 80 }),
    db.socialPost.findMany({ where: { projectId, status: "REJECTED" }, select: { idea: true, rejectionReason: true }, orderBy: { reviewedAt: "desc" }, take: 30 }),
  ]);
  const KIND_HINT: Record<string, string> = {
    static: "one image post: one sharp point",
    carousel: "a swipeable carousel of 4-6 slides: a step-by-step, a checklist, a breakdown or a story in stages, something people save",
    video: "a silent Reel (10-14 seconds, 3 lines of text over one visual: a problem the viewer recognises, how the business solves it for them, the payoff): one practical topic a business owner instantly recognises",
  };
  const prompt = `Plan the social media posts of ${p.client.name}'s own accounts (${p.platforms.join(", ")}) for ${month}. There is one numbered slot per post; write exactly one idea for every slot.

BUSINESS: ${businessLine(p.client)}

TARGETED SERVICES (every idea must be about exactly one of these, written exactly as here): ${p.services.join(" | ")}

SERVICE CARDS (facts you may use; never invent others):
${cards}

${brand}

${brain}

${research}

CONTENT PILLARS:
${PILLARS.map((x) => `- ${x.key}: ${x.label}. ${x.hint}`).join("\n")}

POST FORMATS:
${Object.entries(KIND_HINT).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

ANGLES (each idea uses one; use the key):
${ANGLES.map((a) => `- ${a.key}: ${a.label}. ${a.hint}`).join("\n")}

SLOTS (number. date, format, pillar):
${plan.map((x, n) => `${n + 1}. ${x.day} (${new Date(`${x.day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}), ${x.kind}, ${x.pillar}${x.event ? `: ${x.event.name} (${x.event.why})` : ""}`).join("\n")}

RULES
- Each idea must fit its slot's pillar and format. An event slot is about that event, posted on that day.
- STAY ON THE SERVICES: every non-event idea is about a concrete part of one targeted service (what it is, what goes wrong without it, how it works, what it gets the buyer). No general business, mindset, leadership, productivity or client-relationship topics (no "how to keep clients happy", "building trust with customers", "communication with your agency").
- NOTHING SENSITIVE: no religion, politics, wars or tragedies, health, money trouble, layoffs, legal disputes, criticism of customers or of other businesses, and nothing that could upset or embarrass a client.
- An idea is one specific, concrete post, not a topic. Bad: "Benefits of SEO". Good: "Your Google Business Profile category is probably wrong, and it is costing you map calls".
- Think like the buyer scrolling a feed: a fear, a surprise, a mistake they might be making, a decision they are stuck on, a moment in their week or season.
- Use the competitor research indirectly: aim at the pains and buyers that win attention, borrow the shape of what works, and lean into the gaps they leave. Never copy a competitor's idea or wording, and never mention or hint at a competitor.
- Spread the slots evenly across the services, and vary the angles (event slots use "moment").
- No invented numbers, prices, discounts, awards, client names or guarantees.
- Every idea pairs a buyer problem with what ${p.client.name} does to solve it. We sell the service, we don't teach DIY: no how-to tips the buyer would do themselves.
- Do not repeat or lightly reword these recent posts:
${recent.map((r) => `  - [${r.service} / ${r.angle}] ${r.idea}`).join("\n") || "  (none yet)"}
- Hamza rejected these, so avoid what made them weak:
${rejected.map((r) => `  - ${r.idea} -> reason: ${r.rejectionReason || "not given"}`).join("\n") || "  (none yet)"}

Score each idea 1-10 for: how hard the hook stops a scroll, how specific it is, how clearly it leads to buying the service, and how fresh it is.

Return JSON: {"ideas":[{"slot":1,"service":"exact service name","angle":"angle key","idea":"the post in one sentence, as specific as possible","why":"why this will work with this audience, 1 short sentence","score":8}]}`;
  const r = await geminiJson<{ ideas?: PlannedIdea[] }>(prompt, { timeoutMs: 200_000, temperature: 0.9, model: textModel() });
  const ideas = (r.ideas ?? [])
    .map((i) => ({ ...i, slot: Number(i.slot), service: p.services.find((s) => s.toLowerCase() === String(i.service ?? "").toLowerCase()) ?? p.services[0], angle: angleOf(String(i.angle)).key, idea: String(i.idea ?? "").trim(), why: String(i.why ?? "").trim(), score: Math.max(1, Math.min(10, Number(i.score) || 5)) }))
    .filter((i) => i.idea);
  if (!ideas.length) throw new Error(`${p.client.name}: the AI returned no usable ideas, try again`);
  const used = new Set<PlannedIdea>();
  const rows = plan.flatMap((x, n) => {
    const i = ideas.find((y) => y.slot === n + 1 && !used.has(y)) ?? ideas.find((y) => !used.has(y) && !(y.slot >= 1 && y.slot <= plan.length));
    if (!i) return [];
    used.add(i);
    const angle = x.pillar === "event" ? "moment" : i.angle;
    return [{ projectId, month, service: i.service, angle, idea: i.idea, why: i.why, score: i.score, scheduledAt: x.at, kind: x.kind, pillar: x.pillar, imageLayout: angleOf(angle).layout }];
  });
  await db.socialPost.createMany({ data: rows });
  return rows.length;
}

/** One replacement idea for a rejected post (same date, same service), using what was just learned. */
export async function planReplacement(rejectedId: string) {
  const old = await db.socialPost.findUniqueOrThrow({ where: { id: rejectedId } });
  const { p, cards, brand, brain } = await projectContext(old.projectId);
  const research = researchText(p.research, "ideas");
  const prompt = `Hamza rejected this social post idea for ${p.client.name}: "${old.idea}" (angle: ${old.angle}). Reason: ${old.rejectionReason || "not given"}.
Write ONE better idea for the same service "${old.service}", taking the reason into account. Use a different angle unless the reason says the angle was fine.
It is a ${old.kind === "video" ? "short animated Reel" : old.kind === "carousel" ? "carousel" : "single image post"}${pillarOf(old.pillar) ? ` in the "${pillarOf(old.pillar)!.label}" pillar (${pillarOf(old.pillar)!.hint})` : ""}.

BUSINESS: ${businessLine(p.client)}
SERVICE CARDS:
${cards}
${brand}
${brain}
${research}

ANGLES: ${ANGLES.map((a) => `${a.key} (${a.label})`).join(", ")}
No invented numbers, prices, awards or guarantees.
Return JSON: {"angle":"angle key","idea":"one specific sentence","why":"1 short sentence","score":8}`;
  const r = await geminiJson<Partial<PlannedIdea>>(prompt, { timeoutMs: 90_000, temperature: 0.9, model: textModel() });
  const angle = angleOf(String(r.angle)).key;
  return db.socialPost.create({
    data: { projectId: old.projectId, month: old.month, service: old.service, angle, idea: String(r.idea ?? old.idea), why: String(r.why ?? ""), score: Number(r.score) || 5, scheduledAt: old.scheduledAt, kind: old.kind, pillar: old.pillar, imageLayout: angleOf(angle).layout },
  });
}

type DesignOut = { kicker?: string; big?: string; note?: string; title?: string; items?: string[]; left?: string; right?: string; rows?: string[][] };

type Written = {
  id: string;
  hooks?: string[];
  caption?: CaptionParts;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  firstComment?: string;
  altText?: string;
  headline?: { top?: string; main?: string; bottom?: string };
  format?: string;
  design?: DesignOut;
  photoId?: string;
  imageBrief?: string;
  slides?: { title?: string; body?: string }[];
  end?: string;
  scenes?: string[];
};

const one = (s: unknown) => String(s ?? "").replace(/—/g, ",").replace(/\s+/g, " ").trim();
const flat = (s: unknown) => one(s).replace(/\|/g, "/");

/** The AI's design fields as the plain text the image editor uses (see FORMAT_HELP). */
export function designToText(format: string, d: DesignOut | undefined): string {
  if (!d) return "";
  if (format === "type") return [one(d.kicker), one(d.big)].filter(Boolean).join("\n");
  if (format === "note") return String(d.note ?? "").replace(/—/g, ",").replace(/\n{3,}/g, "\n\n").trim();
  if (format === "list") return [one(d.title), ...(d.items ?? []).map(one).filter(Boolean).slice(0, 6)].filter(Boolean).join("\n");
  if (format === "versus") {
    const rows = (d.rows ?? []).filter((r) => Array.isArray(r) && r.length >= 2).slice(0, 6).map((r) => `${flat(r[0])} | ${flat(r[1])}`);
    return rows.length ? [one(d.title), `${flat(d.left) || "Usually"} | ${flat(d.right) || "Better"}`, ...rows].join("\n") : "";
  }
  return "";
}

const DESIGN_GUIDE = `THE IMAGE is the first thing people see, so it must stop the scroll on its own. One strong picture, very few words. Never fill the image with text.
FORMATS:
- concept (the default): an AI picture with a few words on a solid band above it. imageBrief = the PROMPT for the image model (Google Imagen). It is sent exactly as you write it, so write it as a plain, literal description of ONE real scene that directly shows this post's topic, the way the buyer would recognise it in their own life or business. RELEVANCE FIRST: someone who sees only the picture must know what the post is about. Start from the caption title: picture the one real thing the buyer sees when this topic happens to them, and show exactly that. When the topic is about a platform or tool (Amazon, Google, Instagram, a website, an app, ads), show a phone or laptop with that recognisable kind of page in a real setting. When it is about a holiday or event, show its decorations, places or objects as they look in the country.
  MOOD AND COLOUR MATCH THE BUSINESS: think about what the business sells and how its buyers want to feel. A painting, decor, cleaning, flower, food, kids or events business needs bright, cheerful, vivid colour (freshly painted walls in bold colours, sunlight, colour swatches, clean bright rooms): write "vivid, colourful, bright" into the prompt. A finance, legal or B2B tech business can be calmer and natural. Never dull, grey or washed out for a business that sells colour or a fresh look.
  NO PEOPLE: never show people, faces, hands or bodies, not even in the background. Show the place, the objects, the screen or the product on its own.
  Write 2-4 sentences covering: the main subject and what is happening; the setting (a real place in the client's city or country when it fits); the composition and camera (e.g. close-up, eye level, shallow depth of field); the light and mood. Default style: a candid, everyday photo as a real person would take it on their phone (not a polished stock or studio shot, never a 3D render or illustration).
  Good examples: "Close-up of a smartphone lying on a bakery counter in Dubai, its screen showing a Google Maps business listing with a row of empty star ratings, fresh bread in the background, warm morning light, shallow depth of field, realistic photo." / "An online shopper's laptop on a sofa with a checkout page open and a full shopping basket icon, a cup of coffee beside it, evening lamp light, realistic photo."
  Never: abstract metaphors (no rockets, lightbulbs, chess pieces, puzzle pieces, trophies, mountains, handshakes, glowing holograms, floating icons), stock-photo clichés (desks with glowing screens, perfect empty offices), or anything whose link to the topic needs explaining. Screens may show a recognisable layout (a map, a shop page, search results) but no readable words. No text in the image: the words go on the band.
- photo: one of OUR REAL PHOTOS (from the library below) with a few words. Only when a library photo truly fits the post (behind the scenes, team, real work, proof). Set photoId.
- type: big bold words only, for a sharp opinion or a line strong enough on its own. design.kicker = 1-4 small words on top. design.big = 3-8 words. Put *stars* around 1-2 words to highlight them.
WORDS ON THE IMAGE: headline.main = 2-6 words that name the topic plainly, so someone scrolling knows at once what the post is about: a short version of the caption title that uses the topic's own words (e.g. "Amazon retargeting has changed", "Is your Google listing complete?"). No riddles, puns or vague teasers ("The secret nobody tells you", "Game changer", "Here's the truth"). headline.top = 0-4 small words of setup, or empty. headline.bottom = empty unless it is truly needed. No invented numbers.`;

/** The service page for each service (saved on its card; looked up on the site once when missing). */
async function serviceLinks(p: SocialProject & { client: Client; serviceCards: { service: string; url: string; card: string }[] }, services: string[]) {
  const out: Record<string, string> = {};
  for (const s of [...new Set(services)]) {
    const card = p.serviceCards.find((c) => c.service === s);
    let url = cardUrl(card, p.client.siteUrl);
    if (!url) {
      const known = [...p.client.linkPool, ...(await db.gscPage.findMany({ where: { clientId: p.clientId }, select: { page: true }, orderBy: { clicks: "desc" }, take: 200 })).map((g) => g.page)];
      url = (await servicePage(p.client.siteUrl, s, known).catch(() => ({ url: "" }))).url;
      if (url && card) await db.socialServiceCard.update({ where: { projectId_service: { projectId: p.id, service: s } }, data: { url } });
    } else if (card && !card.url) await db.socialServiceCard.update({ where: { projectId_service: { projectId: p.id, service: s } }, data: { url } });
    out[s] = url;
  }
  return out;
}

/** Write hooks, captions, headline and image design for up to ~4 posts of one project in one AI call. */
export async function writePosts(posts: SocialPost[]) {
  if (!posts.length) return;
  const { p, cards, brand, brain } = await projectContext(posts[0].projectId);
  const link = p.client.ctaLink || p.client.siteUrl;
  const on = (x: Platform) => p.platforms.includes(x);
  const library = await db.socialMedia.findMany({ where: { projectId: p.id, description: { not: "" } }, select: { id: true, description: true, usedCount: true }, orderBy: [{ usedCount: "asc" }, { createdAt: "desc" }], take: 40 });
  // The AI picks between these; note, list and versus are only used when Hamza switches to them.
  const formats = ["concept", ...(library.length ? ["photo"] : []), "type"];
  const system = `You are a top social media copywriter and art director. You write scroll-stopping posts that sound like a sharp, friendly human expert, never like a brochure or an AI.

VOICE
- Conversational and punchy. Short sentences. Talk to "you". Confident, a little bold, never corporate.
- Every line earns its place: a relatable problem and what ${p.client.name} does about it. No filler, no warm-up.
- We sell ${p.client.name}'s services, we don't teach DIY. Name the buyer's problem, then show how ${p.client.name} solves it for them (what ${p.client.name} does and what the buyer gets). Never hand out a do-it-yourself fix or step-by-step instructions.
- Banned words and phrases: ${BANNED}. No em dashes. No "Did you know".
- Never invent statistics, prices, timelines, awards, reviews, client names or guarantees. Use only facts from the service card and brand profile.
- Keywords must read like natural English, with the small words a person would say ("SEO services in Dubai", not "seo services dubai").
- Spelling of the client's country.
- Write the brand name exactly as "${p.client.name}". Never add a country or city tag or slogan to it or to the copy ("AE", "UAE", "Dubai's #1...", "${p.client.name} AE"), even if the website or brand profile does.
- Competitor research is for learning patterns only: never copy their lines, never mention or hint at a competitor.

TITLES (hooks): write 3 different caption titles: 4-10 words each, a headline that states the post's main message in plain words and names the topic (e.g. "Retargeting is no longer basic audience chasing", "Your Google Business Profile is losing you calls"). Bold, specific to this idea, never generic, never a question that hides the topic. hooks[0] is the one used.

CAPTION: one caption in Hamza's layout, used on every platform (we put it together, so return the parts in "caption"):
- emoji: one emoji that fits the topic, shown before the title.
- intro: 1-2 short sentences (max 35 words) on the problem the buyer has, in plain words.
- listTitle: 2-6 words that lead into what ${p.client.name} does (e.g. "How ${p.client.name} fixes it", "What ${p.client.name} handles for you").
- points: 3-5 items, each {"emoji": one emoji that matches that item, "text": 2-9 words}: what ${p.client.name} does to solve it or what the buyer gets, from the service card. Concrete, one idea each, never a DIY tip.
- closing: one sentence on how ${p.client.name} helps with exactly this, naming ${p.client.name} (e.g. "${p.client.name} helps brands adapt to the future of Amazon advertising.").
- hashtags: 12-15 real hashtags that people actually search and follow on Instagram, Facebook and LinkedIn, so the post gets found. Mix them: 4-5 big, popular tags for the field (e.g. #DigitalMarketing, #GoogleAds, #AmazonSeller, #Ecommerce, #SmallBusiness), 4-5 mid-size tags for this exact topic or service (e.g. #PPCTips, #LocalSEO, #AmazonFBA), 2-3 local tags people in the area use (e.g. #DubaiBusiness, #UAEBusiness, #Dubai), then #${p.client.name.replace(/[^\p{L}\p{N}]+/gu, "")}. Put the most relevant first (LinkedIn uses only the first 5). Only well-known, existing hashtags of 1-3 words; never invent long or made-up tags, never stuff the keyword into tags nobody searches, no generic filler (#love, #instagood, #success).
The service page link and the line breaks are added for you, so do not put links, "link in bio" or hashtags in the other parts. A carousel's intro can end by telling people to swipe; a reel's should be short.


${DESIGN_GUIDE}

ALSO, for every post:
- format: one of ${formats.join(", ")}. A suggested format is given per post; change it when another clearly fits better. Mostly concept${library.length ? ", photo when a real photo fits" : ""}; type at most 1 in 4.
- design: only for format "type" (kicker, big); otherwise leave it out.
- headline: the words on the image (see above), always filled in.
- photoId: for format "photo" only, the id of the library photo that fits best; otherwise "".
- imageBrief: the image prompt (see concept above), always filled in, also for photo and type posts (it is used if Hamza switches to an AI picture).
- altText: one sentence describing the finished image for screen readers.

POST TYPES (given per post):
- image: everything above.
- carousel: the image above is the COVER slide (it must make people swipe). Also write slides: 3-5 slides that come after the cover, each {"title": 2-6 words, "body": 1-2 short sentences, max 28 words}. One idea per slide: first the problem and what it costs the buyer, then what ${p.client.name} does about it. Then end: one short closing line for the last slide, a call to action to get ${p.client.name}'s help. Slides follow the caption title and its points, so the carousel and the caption tell the same story.
- reel: a short silent video (about 10-14 seconds). Most people watch it with the sound off and never read the caption, so THE WORDS ON SCREEN MUST CARRY THE MESSAGE on their own. Write scenes: 3 lines (4 at most), shown one after another, each one complete thought of 4-9 words:
  1. HOOK: a problem or question the viewer recognises from their own business, in their words (e.g. "Paying for Google Ads clicks that never call?").
  2. HOW WE SOLVE IT: what ${p.client.name} does for them, said as "we" because the Reel is on ${p.client.name}'s own account (e.g. "We show your ads only to real buyers"). Never a DIY instruction, and no brand name on screen (the caption carries it).
  3. PAYOFF or ACTION: what changes for them, or a call to get in touch (e.g. "Fewer wasted clicks, more real calls").
  (An optional 4th line only when it needs a second thing ${p.client.name} does.)
  Write for a business owner, not a marketer: no agency jargon or insider terms (no "search term scrubbing", "bid adjustments", "CPA", "ROAS", "funnel", "SERP"); if a term is needed, say what it does instead. Say what ${p.client.name} does in the buyer's words (what it fixes for them), not our internal process ("How we manage..."). Each line must make sense even if the previous one was missed. headline.main is the cover text (can match line 1).`;
  const prompt = `BUSINESS: ${businessLine(p.client)}
Main call to action: ${p.client.ctaText || "get in touch"} (${link})

SERVICE CARDS:
${cards}

${brand}

${brain}

${researchText(p.research, "captions")}

${researchText(p.research, "visuals")}

OUR REAL PHOTO LIBRARY (id: what it shows; least used first):
${library.map((m) => `- ${m.id}: ${m.description.slice(0, 220)}${m.usedCount ? ` (used ${m.usedCount}x)` : ""}`).join("\n") || "(empty, so do not use the photo format)"}

POSTS TO WRITE:
${posts
  .map((x) => {
    const fmt = formatOf(x.imageLayout);
    const fixed = x.imageVersion > 0;
    const kind = x.kind === "video" ? "reel" : x.kind === "carousel" ? "carousel" : "image";
    const pillar = pillarOf(x.pillar);
    return `- id ${x.id}: ${kind.toUpperCase()}, service "${x.service}", angle "${angleOf(x.angle).label}" (${angleOf(x.angle).hint})${pillar ? `, pillar "${pillar.label}" (${pillar.hint})` : ""}. Idea: ${x.idea}
  ${fixed ? `Format: ${fmt} (Hamza's choice, keep it)` : `Suggested format: ${fmt === "photo" && !library.length ? "type" : fmt}`}${x.textNote ? `\n  Hamza's note for this rewrite (most important): ${x.textNote}` : ""}${x.captionInstagram || x.captionFacebook || x.captionLinkedin ? `\n  Previous version (do better, don't copy): ${(x.captionLinkedin || x.captionInstagram || x.captionFacebook).slice(0, 500)}` : ""}`;
  })
  .join("\n")}

Return JSON: {"posts":[{"id":"...","hooks":["","",""],"caption":{"emoji":"","intro":"","listTitle":"","points":[{"emoji":"","text":""}],"closing":"","hashtags":[""]},"format":"type","design":{"kicker":"","big":""},"photoId":"","headline":{"top":"","main":"","bottom":""},"imageBrief":"","altText":"","slides":[{"title":"","body":""}],"end":"","scenes":["","",""]}]} (slides and end only for a carousel, scenes only for a reel)`;
  const r = await geminiJson<{ posts?: Written[] }>(prompt, { system, timeoutMs: 200_000, temperature: 0.8, model: textModel() });
  const out = r.posts ?? [];
  const urls = await serviceLinks(p, posts.map((x) => x.service));
  const clean = (s: unknown, max: number) => String(s ?? "").replace(/—/g, ",").trim().slice(0, max);
  for (const x of posts) {
    const w = out.find((o) => o.id === x.id) ?? (out.length === posts.length ? out[posts.indexOf(x)] : undefined);
    if (!w) throw new Error("The AI skipped this post, it will be retried");
    // Format: Hamza's choice once the post has an image; otherwise the AI's pick (photo only with a real library photo).
    const current = formatOf(x.imageLayout);
    let format = x.imageVersion > 0 ? current : formats.includes(String(w.format)) ? String(w.format) : formats.includes(current) ? current : "concept";
    const media = format === "photo" ? (library.find((m) => m.id === String(w.photoId ?? "").trim()) ?? (x.imageVersion > 0 ? undefined : null)) : undefined;
    if (media === null) format = "concept";
    const old = designOf(x.design);
    const texts = { ...old.texts };
    if (!PICTURE_FORMATS.includes(format)) {
      texts[format] = designToText(format, w.design) || designToText("type", { kicker: w.headline?.top, big: w.headline?.main || x.idea });
    }
    const design: DesignData = { ...old, texts };
    if (x.kind === "carousel") {
      const slides: Slide[] = (w.slides ?? []).map((v) => ({ title: clean(v?.title, 80), body: clean(v?.body, 320) })).filter((v) => v.title || v.body).slice(0, 6);
      if (slides.length) design.slides = slides;
      if (w.end) design.end = clean(w.end, 120);
    }
    if (x.kind === "video") {
      const scenes = (w.scenes ?? []).map((v) => clean(v, 90)).filter(Boolean).slice(0, 4);
      if (scenes.length) design.scenes = scenes;
    }
    const titles = (w.hooks ?? []).map((h) => clean(h, 120)).filter(Boolean).slice(0, 3);
    const parts: CaptionParts = { ...w.caption, title: titles[0] || x.headlineMain || x.idea };
    const caption = (tags: number) => buildCaption(parts, { url: urls[x.service] || p.client.siteUrl, tags });
    await db.socialPost.update({
      where: { id: x.id },
      data: {
        // The title choices are stored as finished title lines, so picking one swaps the caption's first line.
        hooks: titles.map((h) => titleLine(h, w.caption?.emoji)),
        captionInstagram: on("instagram") ? caption(15).slice(0, 2200) : "",
        captionFacebook: on("facebook") ? caption(15).slice(0, 3000) : "",
        captionLinkedin: on("linkedin") ? caption(5).slice(0, 3000) : "",
        firstComment: "",
        altText: clean(w.altText, 400),
        headlineTop: clean(w.headline?.top, 60),
        headlineMain: clean(w.headline?.main, 60),
        headlineBottom: clean(w.headline?.bottom, 80),
        imageBrief: clean(w.imageBrief, 1500),
        imageLayout: format,
        design: design as Prisma.InputJsonValue,
        ...(media ? { mediaId: media.id } : {}),
        textNote: null,
      },
    });
    if (media && media.id !== x.mediaId) await db.socialMedia.update({ where: { id: media.id }, data: { usedCount: { increment: 1 } } });
  }
}

/** Image text for one format, when Hamza switches a post to a format it has no text for yet. */
export async function writeDesignText(post: SocialPost, format: string): Promise<string> {
  const { p, brain } = await projectContext(post.projectId);
  const prompt = `${DESIGN_GUIDE}

${brain}

Write the image text for this social post of ${p.client.name} in the "${format}" format.
Idea: ${post.idea}
Caption: ${(post.captionInstagram || post.captionLinkedin || post.captionFacebook).slice(0, 1200)}

Return JSON: {"design":{...the fields for ${format}...}}`;
  const r = await geminiJson<{ design?: DesignOut }>(prompt, { timeoutMs: 60_000, temperature: 0.7, model: textModel() });
  return designToText(format, r.design);
}

/**
 * The learning agent: reads this project's feedback (rejections with reasons, edits, regenerate
 * notes, approvals) and rewrites the project's rules. Every idea and caption prompt includes them.
 */
export async function updateBrain(projectId: string) {
  const p = await db.socialProject.findUniqueOrThrow({ where: { id: projectId }, include: { client: { select: { name: true } } } });
  p.client.name = brandName(p.client.name);
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
