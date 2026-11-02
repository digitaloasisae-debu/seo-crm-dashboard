import { db } from "./db";

/**
 * Posting dates for one month. Uses the client's preferred dates in that month if any,
 * otherwise splits the month into N equal segments and picks one day in each
 * (same approach as WF0 "Generate Posting Dates", but deterministic: the middle day of each segment).
 */
export function planMonth(year: number, month0: number, postsPerMonth: number, preferred: string[]): Date[] {
  const inMonth = preferred
    .map((d) => new Date(`${d}T00:00:00Z`))
    .filter((d) => !isNaN(+d) && d.getUTCFullYear() === year && d.getUTCMonth() === month0);
  if (inMonth.length) return inMonth;
  if (postsPerMonth <= 0) return [];

  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const size = days / postsPerMonth;
  const out: Date[] = [];
  for (let i = 0; i < postsPerMonth; i++) {
    const start = Math.floor(i * size) + 1;
    const end = Math.max(start, Math.floor((i + 1) * size));
    out.push(new Date(Date.UTC(year, month0, Math.floor((start + end) / 2))));
  }
  return out;
}

/** Create any missing slots for the given month. Safe to run repeatedly. */
export async function ensureSlots(clientId: string, at = new Date()) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
  const dates = planMonth(at.getUTCFullYear(), at.getUTCMonth(), client.postsPerMonth, client.preferredDates);
  if (!dates.length) return 0;
  const res = await db.postingSlot.createMany({
    data: dates.map((scheduledDate) => ({ clientId, scheduledDate })),
    skipDuplicates: true,
  });
  return res.count;
}

/** Earliest open slot today or later, used to date a WordPress draft. */
export async function nextOpenSlot(clientId: string) {
  const now = new Date();
  await ensureSlots(clientId, now);
  await ensureSlots(clientId, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  return db.postingSlot.findFirst({
    where: { clientId, articleId: null, scheduledDate: { gte: today } },
    orderBy: { scheduledDate: "asc" },
  });
}
