"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireClientAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { runAudit } from "@/lib/audit";

export async function runAuditAction(clientId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  // One audit at a time per client; a run older than 3 minutes is treated as stuck.
  const running = await db.siteAudit.findFirst({ where: { clientId, status: "RUNNING", startedAt: { gt: new Date(Date.now() - 180_000) } } });
  if (!running) {
    await db.siteAudit.updateMany({ where: { clientId, status: "RUNNING" }, data: { status: "FAILED", error: "Timed out", finishedAt: new Date() } });
    await runAudit(clientId, user.id);
  }
  revalidatePath(`/clients/${clientId}/seo`);
  revalidatePath("/seo");
}
