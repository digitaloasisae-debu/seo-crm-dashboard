"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireClientAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { refreshGbp } from "@/lib/gbp";
import { dataforseoConfigured } from "@/lib/dataforseo";

const back = (id: string, err?: string) => redirect(`/clients/${id}/gbp${err ? `?err=${encodeURIComponent(err)}` : ""}`);

export async function addGbpAction(clientId: string, formData: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const query = String(formData.get("query") ?? "").trim().slice(0, 1000);
  const label = String(formData.get("label") ?? "").trim().slice(0, 60) || "Main";
  if (!query) back(clientId, "Paste the Google Maps link of the business");
  if ((await db.gbpProfile.count({ where: { clientId } })) >= 10) back(clientId, "Up to 10 profiles per client");
  await db.gbpProfile.create({ data: { clientId, label, query } });
  let err = "";
  if (dataforseoConfigured()) {
    try { await refreshGbp(clientId); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  } else err = "Needs the DataForSEO login in Vercel";
  back(clientId, err || undefined);
}

export async function refreshGbpAction(clientId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  let err = "";
  try { await refreshGbp(clientId); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  back(clientId, err || undefined);
}

export async function deleteGbpAction(clientId: string, profileId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  await db.gbpProfile.deleteMany({ where: { id: profileId, clientId } });
  back(clientId);
}

export async function renameGbpAction(clientId: string, profileId: string, formData: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const label = String(formData.get("label") ?? "").trim().slice(0, 60);
  if (label) await db.gbpProfile.updateMany({ where: { id: profileId, clientId }, data: { label } });
  back(clientId);
}
