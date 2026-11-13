"use server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { normalizeUrl, runProspect } from "@/lib/prospect";
import { logActivity } from "@/lib/activity";

export async function startProspectAction(fd: FormData) {
  const user = await requireUser();
  const url = normalizeUrl(String(fd.get("url") ?? ""));
  if (!url) redirect("/prospect?err=" + encodeURIComponent("Enter a website address, like example.com"));
  const domain = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  const val = (k: string) => String(fd.get(k) ?? "").trim() || null;
  const p = await db.prospectAudit.create({ data: { url, domain, name: val("name"), city: val("city"), country: val("country"), keyword: val("keyword"), startedById: user.id } });
  await logActivity({ actorId: user.id, action: "prospect.audit", entity: "prospect", entityId: p.id, after: { domain } });
  after(() => runProspect(p.id));
  redirect(`/prospect/${p.id}`);
}

export async function deleteProspectAction(id: string) {
  await requireUser();
  await db.prospectAudit.delete({ where: { id } }).catch(() => null);
  revalidatePath("/prospect");
  redirect("/prospect");
}
