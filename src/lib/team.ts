/**
 * Team overview for admins: each member's clients (projects), what is waiting in them, and what the member got done.
 * "Waiting" belongs to the client's owner. "Done" is what the member did themselves (from the activity log).
 */
import { db } from "./db";

export type ClientWork = {
  id: string;
  name: string;
  access: "OWNER" | "EDIT";
  keywords: number; // waiting for approval
  topics: number; // waiting for approval
  review: number; // articles to review (incl. changes requested)
  toSend: number; // approved, not sent to WordPress yet
  failed: number; // failed to send
  google: number; // Google review replies and posts waiting
  sentMonth: number; // articles sent to WordPress this month
  missed: number; // posting dates in the last 30 days with no article
  next: Date | null; // next posting date
};
export type Done = { keywords: number; topics: number; articles: number; sent: number; google: number; total: number };
export type MemberWork = {
  id: string;
  name: string;
  role: string;
  lastActive: Date | null;
  clients: ClientWork[];
  pending: number;
  week: Done;
  month: Done;
};

const DONE_ACTIONS = ["keyword.approved", "topic.approved", "article.approved", "article.push", "gbp.reply_posted", "gbp.post_posted"];
const weekStart = (d = new Date()) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
};
export const pendingOf = (c: ClientWork) => c.keywords + c.topics + c.review + c.toSend + c.failed + c.google;

export async function teamOverview() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const wkStart = weekStart(now);
  const today = new Date(now.toISOString().slice(0, 10));
  const since30 = new Date(today.getTime() - 30 * 864e5);

  const [users, clients] = await Promise.all([
    db.user.findMany({
      where: { active: true, role: { in: ["ADMIN", "MEMBER"] } },
      select: { id: true, name: true, role: true, assignments: { where: { access: { in: ["OWNER", "EDIT"] }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], client: { status: "ACTIVE" } }, select: { clientId: true, access: true } } },
      orderBy: { name: "asc" },
    }),
    db.client.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, assignments: { where: { access: "OWNER" }, select: { userId: true } } }, orderBy: { name: "asc" } }),
  ]);
  const ids = clients.map((c) => c.id);
  const inC = { clientId: { in: ids } };
  const [kw, tp, rv, ts, fl, gr, gp, sent, missed, next, acts, last] = await Promise.all([
    db.keyword.groupBy({ by: ["clientId"], where: { ...inC, status: "PENDING" }, _count: true }),
    db.topic.groupBy({ by: ["clientId"], where: { ...inC, status: "GENERATED" }, _count: true }),
    db.article.groupBy({ by: ["clientId"], where: { ...inC, status: { in: ["READY_FOR_REVIEW", "CHANGES_REQUESTED"] } }, _count: true }),
    db.article.groupBy({ by: ["clientId"], where: { ...inC, status: "APPROVED" }, _count: true }),
    db.article.groupBy({ by: ["clientId"], where: { ...inC, status: "PUSH_FAILED" }, _count: true }),
    db.gbpReview.groupBy({ by: ["clientId"], where: { ...inC, status: "DRAFTED" }, _count: true }),
    db.gbpPost.groupBy({ by: ["clientId"], where: { ...inC, status: "DRAFTED" }, _count: true }),
    db.article.groupBy({ by: ["clientId"], where: { ...inC, pushedAt: { gte: monthStart } }, _count: true }),
    db.postingSlot.groupBy({ by: ["clientId"], where: { ...inC, scheduledDate: { gte: since30, lt: today }, articleId: null }, _count: true }),
    db.postingSlot.findMany({ where: { ...inC, scheduledDate: { gte: today } }, select: { clientId: true, scheduledDate: true }, orderBy: { scheduledDate: "asc" }, distinct: ["clientId"] }),
    db.activityLog.findMany({ where: { action: { in: DONE_ACTIONS }, at: { gte: monthStart < wkStart ? monthStart : wkStart }, actorId: { not: null } }, select: { actorId: true, action: true, after: true, at: true } }),
    db.activityLog.groupBy({ by: ["actorId"], where: { actorId: { in: users.map((u) => u.id) } }, _max: { at: true } }),
  ]);
  const count = (rows: { clientId: string; _count: number }[]) => new Map(rows.map((r) => [r.clientId, r._count]));
  const m = { kw: count(kw), tp: count(tp), rv: count(rv), ts: count(ts), fl: count(fl), gr: count(gr), gp: count(gp), sent: count(sent), missed: count(missed) };
  const nextBy = new Map(next.map((s) => [s.clientId, s.scheduledDate]));
  const work = (c: { id: string; name: string }, access: "OWNER" | "EDIT"): ClientWork => ({
    id: c.id, name: c.name, access,
    keywords: m.kw.get(c.id) ?? 0, topics: m.tp.get(c.id) ?? 0, review: m.rv.get(c.id) ?? 0, toSend: m.ts.get(c.id) ?? 0, failed: m.fl.get(c.id) ?? 0,
    google: (m.gr.get(c.id) ?? 0) + (m.gp.get(c.id) ?? 0), sentMonth: m.sent.get(c.id) ?? 0, missed: m.missed.get(c.id) ?? 0, next: nextBy.get(c.id) ?? null,
  });
  const byId = new Map(clients.map((c) => [c.id, c]));

  const tally = (userId: string, from: Date): Done => {
    const rows = acts.filter((a) => a.actorId === userId && a.at >= from);
    const n = (action: string) => rows.filter((r) => r.action === action).reduce((s, r) => s + (action.startsWith("keyword") || action.startsWith("topic") ? Number((r.after as { count?: number } | null)?.count ?? 1) : 1), 0);
    const d = { keywords: n("keyword.approved"), topics: n("topic.approved"), articles: n("article.approved"), sent: n("article.push"), google: n("gbp.reply_posted") + n("gbp.post_posted") };
    return { ...d, total: d.keywords + d.topics + d.articles + d.sent + d.google };
  };
  const lastBy = new Map(last.map((l) => [l.actorId, l._max.at]));

  const members: MemberWork[] = users.map((u) => {
    const cl = u.assignments
      .map((a) => byId.get(a.clientId) && work(byId.get(a.clientId)!, a.access as "OWNER" | "EDIT"))
      .filter((c): c is ClientWork => !!c)
      .sort((a, b) => (a.access === b.access ? pendingOf(b) - pendingOf(a) : a.access === "OWNER" ? -1 : 1));
    return {
      id: u.id, name: u.name, role: u.role, lastActive: lastBy.get(u.id) ?? null, clients: cl,
      pending: cl.filter((c) => c.access === "OWNER").reduce((s, c) => s + pendingOf(c), 0),
      week: tally(u.id, wkStart), month: tally(u.id, monthStart),
    };
  });
  const unowned = clients.filter((c) => c.assignments.length === 0).map((c) => work(c, "OWNER"));
  const totals = {
    pending: clients.reduce((s, c) => s + pendingOf(work(c, "OWNER")), 0),
    doneWeek: members.reduce((s, x) => s + x.week.total, 0),
    sentMonth: [...m.sent.values()].reduce((s, n) => s + n, 0),
    missed: [...m.missed.values()].reduce((s, n) => s + n, 0),
    clients: clients.length,
  };
  return { members, unowned, totals };
}
