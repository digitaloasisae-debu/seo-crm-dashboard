/**
 * Local clients serve more than their primary city (Austin Gate Repair also serves Round Rock, Cedar Park…).
 * Hamza's rule (2026-11-26): a topic targets the area named in its keyword; with no area in the keyword it targets
 * the primary city. Service areas are targeted only by adding them to the keyword (or picking one on the topic).
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

/** The area a topic targets: the one named in the keyword, else the primary city. */
export async function pickArea(clientId: string, keyword: string) {
  const c = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { primaryCity: true, serviceAreaCities: true } });
  const areas = areasOf(c);
  if (!areas.length) return null;
  return areaInText(keyword, areas) ?? c.primaryCity?.trim() ?? null;
}
