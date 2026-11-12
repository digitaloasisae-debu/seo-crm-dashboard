/** Posting dates: spread a month's posts over the allowed days, at varied local times. */

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Minutes the time zone is ahead of UTC at this instant. */
function tzOffsetMinutes(at: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** A local wall-clock time in `tz` as a real Date. */
export function zoned(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, h, min));
  return new Date(guess.getTime() - tzOffsetMinutes(guess, tz) * 60000);
}

/** "YYYY-MM-DDTHH:mm" in the time zone, for <input type="datetime-local">. */
export function toLocalInput(at: Date, tz: string) {
  const local = new Date(at.getTime() + tzOffsetMinutes(at, tz) * 60000);
  return local.toISOString().slice(0, 16);
}

/** Parse a datetime-local value as time in `tz`. */
export function fromLocalInput(v: string, tz: string): Date | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? zoned(+m[1], +m[2], +m[3], +m[4], +m[5], tz) : null;
}

export function fmtLocal(at: Date, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(at);
}

export function monthKey(d: Date, tz = "UTC") {
  const local = new Date(d.getTime() + tzOffsetMinutes(d, tz) * 60000);
  return local.toISOString().slice(0, 7);
}

export function nextMonthKey(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Small deterministic random so the same month always gets the same spread. */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

type SlotOpts = { month: string; count: number; postingDays: string; fromHour: number; toHour: number; timezone: string; notBefore?: Date; taken?: Date[]; seed?: string };

/**
 * `count` posting times in `month`: evenly spread over the allowed days (all days for "Random",
 * or the listed weekdays), each at a different time between fromHour and toHour local time.
 * Days before notBefore are skipped, and days that already have a post are used last.
 */
export function postingSlots(o: SlotOpts): Date[] {
  if (o.count <= 0) return [];
  const [y, m] = o.month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const wanted = o.postingDays
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((d) => d.slice(0, 3))
    .filter((d) => DAYS.includes(d));
  const rand = rng(`${o.seed ?? ""}${o.month}`);
  const notBefore = o.notBefore ?? new Date(0);
  const takenDays = new Set((o.taken ?? []).map((d) => toLocalInput(d, o.timezone).slice(0, 10)));
  let days: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (wanted.length && !wanted.includes(DAYS[dow])) continue;
    if (zoned(y, m, d, 23, 59, o.timezone) <= notBefore) continue;
    days.push(d);
  }
  if (!days.length) return [];
  const free = days.filter((d) => !takenDays.has(`${o.month}-${String(d).padStart(2, "0")}`));
  if (free.length >= o.count) days = free;
  // Pick `count` days evenly across the list (repeat days if there are more posts than days).
  const picked: number[] = [];
  for (let i = 0; i < o.count; i++) {
    const pos = Math.min(days.length - 1, Math.floor(((i + 0.25 + rand() * 0.5) * days.length) / o.count));
    picked.push(days[pos]);
  }
  const span = Math.max(1, o.toHour - o.fromHour);
  return picked
    .map((d) => {
      const minutes = Math.floor(rand() * span * 4) * 15;
      let at = zoned(y, m, d, o.fromHour + Math.floor(minutes / 60), minutes % 60, o.timezone);
      if (at <= notBefore) at = new Date(notBefore.getTime() + 60 * 60000);
      return at;
    })
    .sort((a, b) => a.getTime() - b.getTime());
}

export type WeekSlot = { at: Date; kind: string; day: string };

/**
 * The month's posting plan, week by week (Monday to Saturday, never Sunday): each week gets
 * POSTS_PER_WEEK posts in the WEEK_MIX (1 carousel, 2 Reels, 2 images), one per day, so one weekday
 * stays free. Weeks cut off by the month's start or end, or by `notBefore`, get as many posts as
 * they have days left, with the kinds that are furthest behind the mix. Kinds never sit next to the
 * same kind when it can be helped. Days in `skipDays` ("YYYY-MM-DD", already posted) are left out.
 */
export function weeklySlots(o: { month: string; fromHour: number; toHour: number; timezone: string; notBefore?: Date; skipDays?: Set<string>; seed?: string; mix: Record<string, number> }): WeekSlot[] {
  const [y, m] = o.month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rand = rng(`${o.seed ?? ""}${o.month}:weeks`);
  const notBefore = o.notBefore ?? new Date(0);
  const perWeek = Object.values(o.mix).reduce((a, b) => a + b, 0);
  const total = Object.values(o.mix).reduce((a, b) => a + b, 0);
  // Group the month's Monday-Saturday days into weeks.
  const weeks: number[][] = [];
  let cur: number[] = [];
  let full: number[] = [];
  const fulls: number[][] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow === 0) {
      if (full.length) { weeks.push(cur); fulls.push(full); }
      cur = [];
      full = [];
      continue;
    }
    full.push(d);
    const key = `${o.month}-${String(d).padStart(2, "0")}`;
    if (zoned(y, m, d, 23, 59, o.timezone) <= notBefore || o.skipDays?.has(key)) continue;
    cur.push(d);
  }
  if (full.length) { weeks.push(cur); fulls.push(full); }

  const done: Record<string, number> = Object.fromEntries(Object.keys(o.mix).map((k) => [k, 0]));
  let made = 0;
  const out: WeekSlot[] = [];
  let prevKind = "";
  weeks.forEach((days, wi) => {
    // A whole week posts perWeek times; a cut-off week posts in proportion to its length.
    const weekLen = fulls[wi].length;
    const share = Math.round((perWeek * weekLen) / 6);
    const target = weekLen === 6 ? perWeek : Math.max(weekLen >= 3 ? 1 : 0, share);
    const taken = fulls[wi].filter((d) => o.skipDays?.has(`${o.month}-${String(d).padStart(2, "0")}`)).length;
    const n = Math.min(days.length, Math.max(0, target - taken));
    if (!n) return;
    // Which days: keep them spread, drop random ones.
    const pick = [...days];
    while (pick.length > n) pick.splice(Math.floor(rand() * pick.length), 1);
    // Which kinds: in a full week exactly the mix; otherwise the kinds most behind the month's mix.
    const left: Record<string, number> = { ...o.mix };
    const kinds: string[] = [];
    for (let i = 0; i < n; i++) {
      const options = Object.keys(o.mix).filter((k) => left[k] > 0);
      options.sort((a, b) => {
        const behind = (k: string) => (o.mix[k] / total) * (made + 1) - done[k];
        return behind(b) - behind(a) || rand() - 0.5;
      });
      const k = options.find((x) => x !== (kinds[kinds.length - 1] ?? prevKind)) ?? options[0];
      kinds.push(k);
      left[k]--;
      done[k]++;
      made++;
    }
    // Spread the kinds so the same kind isn't on two days in a row.
    const ordered: string[] = [];
    const pool = [...kinds].sort(() => rand() - 0.5);
    while (pool.length) {
      const last = ordered[ordered.length - 1] ?? prevKind;
      let idx = pool.findIndex((k) => k !== last);
      if (idx < 0) idx = 0;
      ordered.push(pool.splice(idx, 1)[0]);
    }
    prevKind = ordered[ordered.length - 1];
    const span = Math.max(1, o.toHour - o.fromHour);
    pick.forEach((d, i) => {
      const minutes = Math.floor(rand() * span * 4) * 15;
      let at = zoned(y, m, d, o.fromHour + Math.floor(minutes / 60), minutes % 60, o.timezone);
      if (at <= notBefore) at = new Date(notBefore.getTime() + 60 * 60000);
      out.push({ at, kind: ordered[i], day: `${o.month}-${String(d).padStart(2, "0")}` });
    });
  });
  return out;
}
