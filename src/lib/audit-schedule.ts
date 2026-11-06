/**
 * Monthly scheduled audits: start them when due, then (when DataForSEO pings back, or on the daily cron)
 * finish the crawl, run the deep analysis and email the PDF to the client's saved report addresses.
 */
import { db } from "./db";
import { pollCrawl, startCrawl } from "./crawl";
import { claimDeep, runDeepSafe } from "./crawl-deep";
import { sendAuditEmail } from "./audit-email";
import { emailConfigured } from "./email";
import { logActivity } from "./activity";

export function addMonth(d: Date) {
  const n = new Date(d);
  n.setUTCMonth(n.getUTCMonth() + 1);
  return n;
}

/** Starts scheduled audits that are due (a few per run). */
export async function startDueAudits(limit = 3) {
  const due = await db.client.findMany({
    where: { auditSchedule: "monthly", status: "ACTIVE", siteUrl: { not: "" }, auditNextAt: { lte: new Date() }, crawls: { none: { status: "RUNNING" } } },
    orderBy: { auditNextAt: "asc" }, take: limit, select: { id: true, name: true, auditNextAt: true },
  });
  const started: string[] = [];
  for (const c of due) {
    // Move the date first, so a failing start doesn't retry every day forever (it tries again next month).
    let next = addMonth(c.auditNextAt ?? new Date());
    while (next <= new Date()) next = addMonth(next);
    await db.client.update({ where: { id: c.id }, data: { auditNextAt: next } });
    try {
      await startCrawl(c.id, undefined, { scheduled: true });
      started.push(c.name);
    } catch (e) {
      await logActivity({ clientId: c.id, action: "audit.scheduled_failed", entity: "client", entityId: c.id, after: { error: e instanceof Error ? e.message : String(e) } });
    }
  }
  return started;
}

/** Moves one crawl forward as far as it can: finished crawl → deep analysis → email (scheduled ones). */
export async function advanceCrawl(crawlId: string) {
  let crawl = await db.siteCrawl.findUnique({ where: { id: crawlId } });
  if (!crawl) return "missing";
  if (crawl.status === "RUNNING") crawl = await pollCrawl(crawl, true);
  if (crawl.status !== "DONE") return crawl.status.toLowerCase();
  if (!crawl.advancedAt) {
    if (await claimDeep(crawl.id)) await runDeepSafe(crawl.id);
    else return "analysing";
    crawl = await db.siteCrawl.findUniqueOrThrow({ where: { id: crawlId } });
  }
  if (!crawl.scheduled || crawl.emailedAt || crawl.emailError) return "done";
  const client = await db.client.findUniqueOrThrow({ where: { id: crawl.clientId }, select: { auditAutoEmail: true, reportEmails: true } });
  if (!client.auditAutoEmail) return "done";
  if (!client.reportEmails.length || !emailConfigured()) {
    await db.siteCrawl.update({ where: { id: crawl.id }, data: { emailError: !client.reportEmails.length ? "No report email addresses saved for this client" : "Email sending isn't set up (GMAIL_USER / GMAIL_APP_PASSWORD)" } });
    return "no-email";
  }
  // Claim the send so the pingback and the cron can't both email the client.
  const claimed = await db.siteCrawl.updateMany({ where: { id: crawl.id, emailedAt: null }, data: { emailedAt: new Date() } });
  if (!claimed.count) return "done";
  try {
    await sendAuditEmail(crawl.id, client.reportEmails, { scheduled: true });
    await logActivity({ clientId: crawl.clientId, action: "audit.email", entity: "client", entityId: crawl.clientId, after: { to: client.reportEmails, crawlId: crawl.id, scheduled: true } });
    return "emailed";
  } catch (e) {
    await db.siteCrawl.update({ where: { id: crawl.id }, data: { emailedAt: null, emailError: e instanceof Error ? e.message : String(e) } });
    return "email-failed";
  }
}

/** Crawls that still need something: running ones, finished ones without analysis, scheduled ones not emailed. */
export async function pendingCrawls() {
  const week = new Date(Date.now() - 7 * 864e5);
  return db.siteCrawl.findMany({
    where: { startedAt: { gte: week }, OR: [{ status: "RUNNING" }, { status: "DONE", advancedAt: null }, { status: "DONE", scheduled: true, emailedAt: null, emailError: null }] },
    orderBy: { startedAt: "asc" }, take: 10, select: { id: true },
  });
}
