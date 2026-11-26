/**
 * Local clients serve more than their primary city (Austin Gate Repair also serves Round Rock, Cedar Park…).
 * Each topic targets one area: the area named in its keyword, or else the least-covered area so blogs spread
 * across the service areas. The primary city counts half, so it still gets about twice the share of any other area.
 */
import { db } from "./db";

const base = (city: string) => city.split(",")[0].trim();
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function areasOf(c: { primaryCity: string | null; serviceAreaCities: string[] }) {
  const all = [c.primaryCity, ...c.serviceAreaCities].map((x) => (x ?? "").trim()).filter(Boolean);
  return all.filter((x, i) => all.findIndex((y) => key(base(y)) === key(base(x))) === i);
}

/** The area a keyword names ("gate repair round rock tx" → "Round Rock, TX"), if any. Longest name wins. */
export function areaInText(text: string, areas: string[]) {
  const t = ` ${key(text)} `;
  return [...areas].sort((a, b) => base(b).length - base(a).length).find((a) => t.includes(` ${key(base(a))} `)) ?? null;
}

/** The area a new topic should target. */
export async function pickArea(clientId: string, keyword: string, title = "") {
  const c = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { primaryCity: true, serviceAreaCities: true } });
  const areas = areasOf(c);
  if (!areas.length) return null;
  const named = areaInText(`${keyword} ${title}`, areas);
  if (named) return named;
  if (areas.length === 1) return areas[0];
  const recent = await db.topic.findMany({ where: { clientId, generatedAt: { gte: new Date(Date.now() - 180 * 864e5) } }, select: { targetCity: true } });
  const used = (a: string) => recent.filter((r) => (r.targetCity ? key(base(r.targetCity)) === key(base(a)) : a === areas[0])).length * (a === areas[0] ? 0.5 : 1);
  return [...areas].sort((a, b) => used(a) - used(b))[0];
}
