"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireClientAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { draftBrandProfile } from "@/lib/brand-profile";

const lines = (v: FormDataEntryValue | null) => String(v ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean).slice(0, 40);
const text = (v: FormDataEntryValue | null, max = 4000) => String(v ?? "").trim().slice(0, max);

export async function saveBrandProfileAction(clientId: string, fd: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const data = {
    voice: text(fd.get("voice"), 600),
    audience: text(fd.get("audience"), 600),
    toneWords: lines(fd.get("toneWords")),
    bannedWords: lines(fd.get("bannedWords")),
    alwaysUse: lines(fd.get("alwaysUse")),
    facts: text(fd.get("facts")),
    examples: text(fd.get("examples"), 2000),
    spelling: fd.get("spelling") === "UK" ? "UK" : "US",
    person: text(fd.get("person"), 60) || "we",
    ctaStyle: text(fd.get("ctaStyle"), 400),
    updatedById: user.id,
  };
  await db.brandProfile.upsert({ where: { clientId }, create: { clientId, ...data }, update: data });
  await logActivity({ actorId: user.id, clientId, action: "brand.update", entity: "client", entityId: clientId });
  revalidatePath(`/clients/${clientId}/brand`);
  redirect(`/clients/${clientId}/brand?saved=1`);
}

export async function draftBrandProfileAction(clientId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  let err = "";
  try {
    const d = await draftBrandProfile(clientId);
    await db.brandProfile.upsert({ where: { clientId }, create: { clientId, ...d, updatedById: user.id }, update: { ...d, updatedById: user.id } });
    await logActivity({ actorId: user.id, clientId, action: "brand.draft", entity: "client", entityId: clientId });
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  redirect(`/clients/${clientId}/brand?${err ? `err=${encodeURIComponent(err)}` : "drafted=1"}`);
}
