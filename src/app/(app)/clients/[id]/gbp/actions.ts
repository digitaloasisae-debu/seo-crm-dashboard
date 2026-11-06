"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { draftReplies, draftWeeklyPosts, queueReviewFetch } from "@/lib/gbp-content";
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

// ---------- Reviews and weekly posts ----------

async function guard(clientId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  return user;
}
const to = (id: string, q: string) => redirect(`/clients/${id}/gbp?${q}#content`);

export async function fetchReviewsAction(clientId: string) {
  await guard(clientId);
  const profiles = await db.gbpProfile.findMany({ where: { clientId }, select: { id: true } });
  let err = "", n = 0;
  for (const p of profiles) {
    try { await queueReviewFetch(p.id); n++; } catch (e) { err = e instanceof Error ? e.message : String(e); }
  }
  to(clientId, n ? "fetching=1" : `err=${encodeURIComponent(err || "Add a profile first")}`);
}

export async function draftRepliesAction(clientId: string) {
  await guard(clientId);
  let err = "";
  try { await draftReplies(clientId); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  to(clientId, err ? `err=${encodeURIComponent(err)}` : "drafted=1");
}

export async function draftPostsAction(clientId: string) {
  await guard(clientId);
  let err = "";
  try { await draftWeeklyPosts(clientId, { force: true }); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  to(clientId, err ? `err=${encodeURIComponent(err)}` : "drafted=1");
}

const STATUSES = ["DRAFTED", "APPROVED", "POSTED", "SKIPPED"] as const;
type S = (typeof STATUSES)[number];

/** Save an edited reply; the button pressed decides the new status. */
export async function saveReplyAction(clientId: string, reviewId: string, formData: FormData) {
  const user = await guard(clientId);
  const draft = String(formData.get("draft") ?? "").trim().slice(0, 1500);
  const status = String(formData.get("status") ?? "APPROVED") as S;
  if (!STATUSES.includes(status)) return;
  await db.gbpReview.updateMany({ where: { id: reviewId, clientId }, data: { ...(draft ? { draft } : {}), status, ...(status === "POSTED" && draft ? { ownerReply: draft } : {}) } });
  if (status === "POSTED") await logActivity({ actorId: user.id, clientId, action: "gbp.reply_posted", entity: "gbpReview", entityId: reviewId });
  revalidatePath(`/clients/${clientId}/gbp`);
  revalidatePath("/", "layout");
}

export async function savePostAction(clientId: string, postId: string, formData: FormData) {
  const user = await guard(clientId);
  const text = String(formData.get("text") ?? "").trim().slice(0, 1500);
  const status = String(formData.get("status") ?? "APPROVED") as S;
  if (!STATUSES.includes(status)) return;
  await db.gbpPost.updateMany({ where: { id: postId, clientId }, data: { ...(text ? { text } : {}), status } });
  if (status === "POSTED") await logActivity({ actorId: user.id, clientId, action: "gbp.post_posted", entity: "gbpPost", entityId: postId });
  revalidatePath(`/clients/${clientId}/gbp`);
  revalidatePath("/", "layout");
}
