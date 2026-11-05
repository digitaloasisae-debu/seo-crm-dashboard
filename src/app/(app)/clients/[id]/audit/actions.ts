"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireClientAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { startCrawl } from "@/lib/crawl";

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
