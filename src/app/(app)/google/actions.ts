"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { requireClientAccess } from "@/lib/access";
import { requireSuperAdmin, requireUser } from "@/lib/session";
import { listSites, matchSite, syncClient } from "@/lib/google";

export async function setPropertyAction(clientId: string, fd: FormData) {
  const user = await requireSuperAdmin();
  const value = String(fd.get("property") ?? "");
  const [connectionId, ...rest] = value.split("|");
  const property = rest.join("|");
  await db.client.update({
    where: { id: clientId },
    data: value ? { gscProperty: property, gscConnectionId: connectionId, gscSyncedAt: null, gscError: null } : { gscProperty: null, gscConnectionId: null, gscSyncedAt: null },
  });
  if (!value) await db.$transaction([db.gscDaily.deleteMany({ where: { clientId } }), db.gscQueryWeek.deleteMany({ where: { clientId } }), db.gscPage.deleteMany({ where: { clientId } })]);
  await logActivity({ actorId: user.id, clientId, action: "gsc.link", entity: "client", entityId: clientId, after: { property: property || null } });
  revalidatePath("/google");
}

export async function autoMatchAction() {
  await requireSuperAdmin();
  const { sites } = await listSites();
  const clients = await db.client.findMany({ where: { gscProperty: null }, select: { id: true, siteUrl: true, gscAccount: true } });
  for (const c of clients) {
    const m = matchSite(c.siteUrl, sites, c.gscAccount);
    if (m) await db.client.update({ where: { id: c.id }, data: { gscProperty: m.siteUrl, gscConnectionId: m.connectionId } });
  }
  revalidatePath("/google");
}

export async function removeConnectionAction(connectionId: string) {
  const user = await requireSuperAdmin();
  await db.googleConnection.delete({ where: { id: connectionId } });
  await logActivity({ actorId: user.id, action: "gsc.disconnect", entity: "google", entityId: connectionId });
  revalidatePath("/google");
}

export async function syncGscAction(clientId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  try {
    await syncClient(clientId);
  } catch {
    // The error is saved on the client (gscError) and shown on the page.
  }
  revalidatePath(`/clients/${clientId}/seo`);
  revalidatePath(`/clients/${clientId}/keywords`);
}
