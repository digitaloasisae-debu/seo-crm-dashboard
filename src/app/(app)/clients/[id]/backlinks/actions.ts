"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireClientAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { refreshBacklinks } from "@/lib/backlinks";
import { logActivity } from "@/lib/activity";

export async function refreshBacklinksAction(clientId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  let err = "";
  try {
    await refreshBacklinks(clientId, user.id);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  redirect(`/clients/${clientId}/backlinks${err ? `?err=${encodeURIComponent(err)}` : ""}`);
}

export async function saveCompetitorsAction(clientId: string, form: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const list = String(form.get("competitors") ?? "").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const before = await db.client.findUnique({ where: { id: clientId }, select: { competitors: true } });
  await db.client.update({ where: { id: clientId }, data: { competitors: list } });
  await logActivity({ actorId: user.id, clientId, action: "client.competitors", entity: "client", entityId: clientId, before: { competitors: before?.competitors }, after: { competitors: list } });
  redirect(`/clients/${clientId}/backlinks?saved=1`);
}
