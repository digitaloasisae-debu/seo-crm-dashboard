/**
 * Which year blogs target (Hamza's rule, 16 Nov 2026):
 * - January–October: the current year, and the title may name it.
 * - November and December: the content targets NEXT year, but no year goes in the title, SEO title, meta or slug
 *   (a next-year title before the year starts can look spammy). From 1 January the normal rule applies again.
 */
export function yearRule(now = new Date()) {
  const current = now.getUTCFullYear();
  const yearEnd = now.getUTCMonth() >= 10; // November (10) or December (11)
  const target = yearEnd ? current + 1 : current;
  const text = yearEnd
    ? `YEAR RULE (today is ${now.toISOString().slice(0, 10)}, the year is ending): write the content for ${target} (plans, trends, prices and checklists for ${target}). Do NOT put any year in the H1, SEO title, meta title or slug. ${current} and older years only for comparisons or past data. Exceptions: if the focus keyword contains a year (e.g. "Dubai Shopping Festival 2026–27"), keep that year exactly as written in the title; and event-based topics (festivals, expos, conferences, sales seasons, holidays, sports events) keep the event's year or edition in the title. This overrides any year mentioned elsewhere in the SOP.`
    : `YEAR RULE (today is ${now.toISOString().slice(0, 10)}): the current year is ${target}. Use ${target} wherever a year appears (title, intro, prices, stats); older years only for comparisons or past data. This overrides any year mentioned elsewhere in the SOP.`;
  return { current, target, yearEnd, titleYear: !yearEnd, text };
}

/** Dated events: their year belongs in the title even in November and December. */
const EVENT = /\b(festival|expo|gitex|summit|conference|exhibition|fair|week|season|awards?|ramadan|eid|diwali|christmas|new year|national day|black friday|white friday|cyber monday|singles day|world cup|grand prix|f1|marathon|olympics?|budget|calendar|schedule|dates?|holidays?)\b/i;
export const isEventTopic = (text: string) => EVENT.test(text);

/** Every 4-digit year 2000–2099 in a text. */
export const yearsIn = (s: string) => [...new Set((s.match(/\b20\d{2}\b/g) ?? []).map(Number))];
