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
  if (crawl && (await claimDeep(crawlId, true))) after(() => runDeepSafe(crawlId));
  redirect(`/clients/${clientId}/audit`);
}
