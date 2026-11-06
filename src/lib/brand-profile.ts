/**
 * Brand profile: how a client's brand writes (voice, audience, tone words, banned words, facts,
 * examples). It is sent to n8n with every article job and used by every AI writer in the app.
 */
import type { BrandProfile } from "@prisma/client";
import { db } from "./db";
import { geminiJson } from "./gemini";

export type BrandProfileDraft = Omit<BrandProfile, "clientId" | "updatedById" | "updatedAt">;

const list = (xs: string[]) => xs.filter(Boolean).join(", ");

/** The profile as a short markdown block for AI prompts. Empty string when nothing is filled in. */
export function brandProfileText(p: Partial<BrandProfileDraft> | null | undefined): string {
  if (!p) return "";
  const lines: string[] = [];
  if (p.voice) lines.push(`- Voice: ${p.voice}`);
  if (p.toneWords?.length) lines.push(`- Tone: ${list(p.toneWords)}`);
  if (p.audience) lines.push(`- Audience: ${p.audience}`);
  if (p.person) lines.push(`- Write as "${p.person}"${p.person === "we" ? " (the business speaking)" : ""}`);
  if (p.spelling) lines.push(`- Spelling: ${p.spelling === "UK" ? "British English" : "American English"}`);
  if (p.ctaStyle) lines.push(`- Calls to action: ${p.ctaStyle}`);
  if (p.alwaysUse?.length) lines.push(`- Always mention or use: ${list(p.alwaysUse)}`);
  if (p.bannedWords?.length) lines.push(`- Never use these words or claims: ${list(p.bannedWords)}`);
  if (p.facts) lines.push(`- Facts about the business (use only these, never invent others):\n${p.facts.split("\n").filter(Boolean).map((f) => `  - ${f.replace(/^[-*•]\s*/, "")}`).join("\n")}`);
  if (p.examples) lines.push(`- Example of the brand's writing (match this style, don't copy it):\n"""\n${p.examples.slice(0, 1500)}\n"""`);
  return lines.length ? `## Brand profile\n${lines.join("\n")}` : "";
}

/** Brand profile plus the client brain's learned rules: what every AI writer gets for this client. */
export async function brandContext(clientId: string): Promise<string> {
  const [profile, brain] = await Promise.all([db.brandProfile.findUnique({ where: { clientId } }), db.clientBrain.findUnique({ where: { clientId }, select: { rules: true } })]);
  return [brandProfileText(profile), brain?.rules ?? ""].filter(Boolean).join("\n\n");
}

const strip = (html: string) =>
  html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();

async function pageText(url: string) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; RankflowBot/1.0)" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!r.ok) return "";
    return strip(await r.text()).slice(0, 6000);
  } catch {
    return "";
  }
}

/** Draft a brand profile from the client's website and onboarding answers. */
export async function draftBrandProfile(clientId: string): Promise<BrandProfileDraft> {
  const c = await db.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { name: true, siteUrl: true, businessType: true, primaryCity: true, serviceAreaCities: true, servicesOffered: true, targetAudience: true, brandVoiceAvoid: true, ctaText: true, targetCountry: true },
  });
  const base = c.siteUrl.replace(/\/+$/, "");
  const [home, about] = await Promise.all([pageText(base), pageText(`${base}/about/`).then((t) => t || pageText(`${base}/about-us/`))]);
  const prompt = `Write a brand profile for an AI blog writer, for this business. Base it on the website text and onboarding answers. Do not invent facts.

Business: ${c.name} (${c.businessType ?? "business"}), ${c.primaryCity ?? ""} ${c.targetCountry ?? ""}
Services: ${c.servicesOffered.join(", ")}
Service areas: ${c.serviceAreaCities.join(", ")}
Audience (onboarding): ${c.targetAudience ?? "not given"}
Words/claims to avoid (onboarding): ${c.brandVoiceAvoid ?? "none"}
Main call to action: ${c.ctaText ?? "not given"}

HOME PAGE TEXT:
${home || "(could not load)"}

ABOUT PAGE TEXT:
${about || "(could not load)"}

Return JSON:
{"voice":"1-2 sentences on how the brand sounds","audience":"who they write for, 1 sentence","toneWords":["3-5 adjectives"],"bannedWords":["words, phrases or claims to avoid, include the onboarding ones plus generic AI cliches like 'delve', 'in today's fast-paced world'"],"alwaysUse":["key phrases, service names or selling points to mention"],"facts":"one fact per line, only facts stated on the website (years in business, licences, warranties, areas, phone hours)","examples":"2-4 sentences copied from the website that best show the brand's voice","spelling":"US or UK","person":"we, I or the brand name","ctaStyle":"how to ask readers to act, 1 sentence"}`;
  const r = await geminiJson<Partial<BrandProfileDraft>>(prompt, { timeoutMs: 90_000, temperature: 0.3 });
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 25) : []);
  return {
    voice: String(r.voice ?? ""),
    audience: String(r.audience ?? ""),
    toneWords: arr(r.toneWords),
    bannedWords: arr(r.bannedWords),
    alwaysUse: arr(r.alwaysUse),
    facts: String(r.facts ?? ""),
    examples: String(r.examples ?? ""),
    spelling: r.spelling === "UK" ? "UK" : "US",
    person: String(r.person ?? "we") || "we",
    ctaStyle: String(r.ctaStyle ?? ""),
  };
}
