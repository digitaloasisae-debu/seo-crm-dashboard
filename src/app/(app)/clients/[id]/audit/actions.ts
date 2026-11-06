"use server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { claimDeep, runDeepSafe } from "@/lib/crawl-deep";
import { db } from "@/lib/db";
import { requireClientAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { startCrawl } from "@/lib/crawl";
import { fixCrawlIssue } from "@/lib/crawl-fix";

export async function startCrawlAction(clientId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  let err = "";
  const running = await db.siteCrawl.findFirst({ where: { clientId, status: "RUNNING" } });
  if (!running) {
    try {
      await startCrawl(clientId, user.id);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
  }
  redirect(`/clients/${clientId}/audit${err ? `?err=${encodeURIComponent(err)}` : ""}`);
}

export async function fixIssueAction(clientId: string, crawlId: string, code: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  let err = "";
  try {
    const crawl = await db.siteCrawl.findFirst({ where: { id: crawlId, clientId } });
    if (!crawl) throw new Error("Audit not found");
    await fixCrawlIssue(crawlId, code);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  redirect(`/clients/${clientId}/audit?open=${encodeURIComponent(code)}${err ? `&err=${encodeURIComponent(`AI fix: ${err}`)}` : ""}#issue-${code}`);
}

export async function rerunDeepAction(clientId: string, crawlId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const crawl = await db.siteCrawl.findFirst({ where: { id: crawlId, clientId } });
  if (crawl && (await claimDeep(crawlId, true))) after(() => runDeepSafe(crawlId, true));
  redirect(`/clients/${clientId}/audit`);
}

/** Monthly schedule, auto-email recipients and JavaScript rendering for this client's audits. */
export async function saveAuditSettingsAction(clientId: string, formData: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const schedule = formData.get("schedule") === "monthly" ? "monthly" : "off";
  const emails = [...new Set(String(formData.get("emails") ?? "").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  const bad = emails.filter((x) => !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x));
  if (bad.length) redirect(`/clients/${clientId}/audit?err=${encodeURIComponent(`Settings: not a valid email: ${bad.join(", ")}`)}#audit-settings`);
  const day = String(formData.get("next") ?? "");
  const next = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T06:00:00Z`) : null;
  await db.client.update({
    where: { id: clientId },
    data: {
      auditSchedule: schedule,
      auditNextAt: schedule === "monthly" ? next ?? new Date(Date.now() + 864e5) : null,
      auditAutoEmail: formData.get("autoEmail") === "on",
      auditJsRender: formData.get("js") === "on",
      reportEmails: emails.slice(0, 10),
    },
  });
  redirect(`/clients/${clientId}/audit?saved=1#audit-settings`);
}
