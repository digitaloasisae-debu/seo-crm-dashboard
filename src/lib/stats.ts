import { db } from "./db";

const WORK = ["keyword.approved", "topic.approved", "article.approved", "article.push"];
const weekStart = (d = new Date()) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
};
const weight = (r: { action: string; after: unknown }) => (r.action.startsWith("keyword") || r.action.startsWith("topic") ? Number((r.after as { count?: number } | null)?.count ?? 1) : 1);

/** This week's wins for one user, their daily streak, and the team leaderboard. */
export async function weeklyWins(userId: string) {
  const start = weekStart();
  const since = new Date(Date.now() - 60 * 864e5);
  const [rows, team] = await Promise.all([
    db.activityLog.findMany({ where: { actorId: userId, action: { in: WORK }, at: { gte: since } }, select: { action: true, after: true, at: true } }),
    db.activityLog.findMany({ where: { action: { in: WORK }, at: { gte: start }, actorId: { not: null } }, select: { actorId: true, action: true, after: true, actor: { select: { name: true } } } }),
  ]);
  const week = rows.filter((r) => r.at >= start);
  const sum = (prefix: string) => week.filter((r) => r.action.startsWith(prefix)).reduce((n, r) => n + weight(r), 0);
  const by = { keywords: sum("keyword"), topics: sum("topic"), approved: week.filter((r) => r.action === "article.approved").length, pushed: week.filter((r) => r.action === "article.push").length };
  const total = by.keywords + by.topics + by.approved + by.pushed;

  // Streak: consecutive days (ending today or yesterday) with at least one win.
  const days = new Set(rows.map((r) => r.at.toISOString().slice(0, 10)));
  let streak = 0;
  const d = new Date();
  if (!days.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
  while (days.has(d.toISOString().slice(0, 10))) { streak++; d.setUTCDate(d.getUTCDate() - 1); }

  const board = new Map<string, { name: string; score: number }>();
  for (const r of team) {
    const e = board.get(r.actorId!) ?? { name: r.actor?.name ?? "Someone", score: 0 };
    e.score += weight(r);
    board.set(r.actorId!, e);
  }
  const leaders = [...board.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.score - a.score).slice(0, 5);
  return { by, total, streak, leaders };
}
