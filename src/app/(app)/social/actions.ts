"use server";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { PLATFORMS, draftServiceCard, planMonth, planReplacement, updateBrain } from "@/lib/social/ai";
import { finishPost, socialWork } from "@/lib/social/work";
import { fromLocalInput } from "@/lib/social/schedule";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const refresh = () => revalidatePath("/social", "layout");
const learn = (projectId: string) => after(() => updateBrain(projectId).catch((e) => console.error("social.brain_failed", e)));

// ---------- projects ----------

function projectData(f: FormData) {
  const list = (k: string) => String(f.get(k) ?? "").split(/[\n,|]+/).map((s) => s.trim()).filter(Boolean);
  const int = (k: string, d: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(f.get(k)) || d)));
  const opt = (k: string) => String(f.get(k) ?? "").trim() || null;
  return {
    active: f.get("active") === "on",
    services: [...new Set(list("services"))].slice(0, 20),
    platforms: PLATFORMS.filter((p) => f.get(`platform_${p}`) === "on"),
    postsPerMonth: int("postsPerMonth", 15, 1, 60),
    postingDays: String(f.get("postingDays") ?? "Random").trim() || "Random",
    postFromHour: int("postFromHour", 10, 0, 23),
    postToHour: int("postToHour", 19, 1, 24),
    timezone: String(f.get("timezone") ?? "Asia/Dubai").trim() || "Asia/Dubai",
    fbPageId: opt("fbPageId"),
    igUserId: opt("igUserId"),
    linkedinOrgId: opt("linkedinOrgId")?.replace(/\D/g, "") || null,
    imageStyle: String(f.get("imageStyle") ?? "").trim().slice(0, 1000),
  };
}

export async function createProjectAction(formData: FormData) {
  await requireSuperAdmin();
  const clientId = String(formData.get("clientId") ?? "");
  const data = projectData(formData);
  if (!clientId) redirect("/social/projects/new?err=Pick+a+client");
  if (await db.socialProject.findUnique({ where: { clientId } })) redirect("/social/projects/new?err=That+client+already+has+a+social+project");
  const p = await db.socialProject.create({ data: { ...data, active: true, clientId } });
  after(async () => {
    for (const s of p.services) await draftServiceCard(p.id, s).catch((e) => console.error("social.card_failed", e));
  });
  redirect(`/social/projects/${p.id}?created=1`);
}

export async function saveProjectAction(projectId: string, formData: FormData) {
  await requireSuperAdmin();
  const data = projectData(formData);
  const before = await db.socialProject.findUniqueOrThrow({ where: { id: projectId }, select: { services: true } });
  await db.socialProject.update({ where: { id: projectId }, data });
  const added = data.services.filter((s) => !before.services.includes(s));
  if (added.length) after(async () => {
    for (const s of added) await draftServiceCard(projectId, s).catch((e) => console.error("social.card_failed", e));
  });
  refresh();
  redirect(`/social/projects/${projectId}?saved=1`);
}

export async function saveCardAction(projectId: string, service: string, formData: FormData) {
  await requireSuperAdmin();
  const card = String(formData.get("card") ?? "").slice(0, 8000);
  await db.socialServiceCard.upsert({ where: { projectId_service: { projectId, service } }, create: { projectId, service, card }, update: { card } });
  refresh();
}

export async function redraftCardAction(projectId: string, service: string) {
  await requireSuperAdmin();
  let err = "";
  try { await draftServiceCard(projectId, service); } catch (e) { err = msg(e); }
  redirect(`/social/projects/${projectId}${err ? `?err=${encodeURIComponent(err)}` : ""}#cards`);
}

export async function saveBrainAction(projectId: string, formData: FormData) {
  await requireSuperAdmin();
  await db.socialProject.update({ where: { id: projectId }, data: { brain: String(formData.get("brain") ?? "").slice(0, 6000), brainUpdatedAt: new Date() } });
  refresh();
}

export async function relearnAction(projectId: string) {
  await requireSuperAdmin();
  let err = "";
  try { await updateBrain(projectId); } catch (e) { err = msg(e); }
  redirect(`/social/projects/${projectId}${err ? `?err=${encodeURIComponent(err)}` : ""}#brain`);
}

// ---------- generating ----------

/** Plan the whole month for the chosen projects at once. Captions and images are then made by the worker. */
export async function generateMonthAction(formData: FormData) {
  await requireSuperAdmin();
  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) redirect("/social?err=Pick+a+month");
  const ids = formData.getAll("project").map(String);
  const projects = await db.socialProject.findMany({ where: { active: true, ...(ids.length ? { id: { in: ids } } : {}) }, include: { client: { select: { name: true } } } });
  if (!projects.length) redirect("/social?err=No+active+projects");
  const results = await Promise.all(projects.map((p) => planMonth(p.id, month).then((n) => ({ ok: true as const, n })).catch((e) => ({ ok: false as const, err: `${p.client.name}: ${msg(e)}` }))));
  const made = results.reduce((a, r) => a + (r.ok ? r.n : 0), 0);
  const errs = results.flatMap((r) => (r.ok ? [] : [r.err]));
  after(() => socialWork(200_000).catch((e) => console.error("social.work_failed", e)));
  redirect(`/social?month=${month}&planned=${made}${errs.length ? `&err=${encodeURIComponent(errs.join(" · "))}` : ""}`);
}

/** Called by the page while drafts are still being made. */
export async function workAction() {
  await requireSuperAdmin();
  const r = await socialWork(170_000);
  refresh();
  return r;
}

export async function retryFailedAction() {
  await requireSuperAdmin();
  await db.socialPost.updateMany({ where: { stage: "error", photo: null, captionInstagram: "", captionFacebook: "", captionLinkedin: "" }, data: { stage: "idea", attempts: 0 } });
  await db.socialPost.updateMany({ where: { stage: "error" }, data: { stage: "written", attempts: 0 } });
  refresh();
}

// ---------- reviewing ----------

type Fields = { captionFacebook: string; captionInstagram: string; captionLinkedin: string; firstComment: string; headlineTop: string; headlineMain: string; headlineBottom: string };
const FIELD_KEYS: (keyof Fields)[] = ["captionFacebook", "captionInstagram", "captionLinkedin", "firstComment", "headlineTop", "headlineMain", "headlineBottom"];

/** Save edits from the post card; logs caption edits for the learning agent. Returns true when the headline changed. */
async function saveEdits(postId: string, f: FormData) {
  const post = await db.socialPost.findUniqueOrThrow({ where: { id: postId }, include: { project: { select: { timezone: true } } } });
  const data: Partial<Fields> & { scheduledAt?: Date } = {};
  for (const k of FIELD_KEYS) {
    const v = f.get(k);
    if (v !== null && String(v).trim() !== post[k].trim()) data[k] = String(v).trim().slice(0, 3000);
  }
  const when = fromLocalInput(String(f.get("scheduledAt") ?? ""), post.project.timezone);
  if (when && Math.abs(when.getTime() - post.scheduledAt.getTime()) > 60_000) data.scheduledAt = when;
  if (!Object.keys(data).length) return { post, headline: false };
  await db.socialPost.update({ where: { id: postId }, data });
  const edits = FIELD_KEYS.filter((k) => k in data && k.startsWith("caption"));
  if (edits.length) {
    await db.socialFeedback.createMany({ data: edits.map((k) => ({ projectId: post.projectId, postId, kind: "edit", note: k.replace("caption", "").toLowerCase() + " caption", before: post[k], after: data[k] ?? "" })) });
  }
  const headline = (["headlineTop", "headlineMain", "headlineBottom"] as const).some((k) => k in data);
  return { post, headline, learned: edits.length > 0 };
}

export async function savePostAction(postId: string, formData: FormData) {
  await requireSuperAdmin();
  const { post, headline, learned } = await saveEdits(postId, formData);
  if (headline && post.photo) {
    await db.socialPost.update({ where: { id: postId }, data: { stage: "written" } });
    await finishPost(postId);
  }
  if (learned) learn(post.projectId);
  refresh();
}

export async function approvePostAction(postId: string, formData: FormData) {
  await requireSuperAdmin();
  const { post, headline, learned } = await saveEdits(postId, formData);
  if (headline && post.photo) {
    await db.socialPost.update({ where: { id: postId }, data: { stage: "written" } });
    await finishPost(postId);
  }
  await db.socialPost.update({ where: { id: postId }, data: { status: "APPROVED", reviewedAt: new Date(), rejectionReason: null } });
  await db.socialFeedback.create({ data: { projectId: post.projectId, postId, kind: "approve", note: learned ? "approved after edits" : "" } });
  if (learned) learn(post.projectId);
  refresh();
}

export async function unapprovePostAction(postId: string) {
  await requireSuperAdmin();
  await db.socialPost.updateMany({ where: { id: postId, status: { in: ["APPROVED", "FAILED"] } }, data: { status: "DRAFT", reviewedAt: null } });
  refresh();
}

export async function rejectPostAction(postId: string, formData: FormData) {
  await requireSuperAdmin();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  if (!reason) throw new Error("Write why you're rejecting it, so the AI learns");
  const replace = formData.get("replace") === "1";
  const post = await db.socialPost.update({ where: { id: postId }, data: { status: "REJECTED", rejectionReason: reason, reviewedAt: new Date() } });
  await db.socialFeedback.create({ data: { projectId: post.projectId, postId, kind: "reject", note: reason } });
  if (replace) {
    // Learn first so the replacement already follows the new rule, then make it right away.
    await updateBrain(post.projectId).catch((e) => console.error("social.brain_failed", e));
    const fresh = await planReplacement(postId);
    await finishPost(fresh.id);
  } else learn(post.projectId);
  refresh();
}

export async function restorePostAction(postId: string) {
  await requireSuperAdmin();
  await db.socialPost.updateMany({ where: { id: postId, status: "REJECTED" }, data: { status: "DRAFT", rejectionReason: null, reviewedAt: null } });
  refresh();
}

/** New captions (and headline) with an optional note. Keeps the photo, redoes the design. */
export async function regenerateTextAction(postId: string, formData: FormData) {
  await requireSuperAdmin();
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  const post = await db.socialPost.update({ where: { id: postId }, data: { textNote: note || "Write a fresh, stronger version", stage: "idea", attempts: 0, stageError: null, status: "DRAFT" } });
  await db.socialFeedback.create({ data: { projectId: post.projectId, postId, kind: "regenerate_text", note } });
  await finishPost(postId);
  if (note) learn(post.projectId);
  refresh();
}

/** A new photo with an optional note. Keeps the captions. */
export async function regenerateImageAction(postId: string, formData: FormData) {
  await requireSuperAdmin();
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  const layout = String(formData.get("layout") ?? "");
  const post = await db.socialPost.update({
    where: { id: postId },
    data: { imageNote: note || null, photo: null, stage: "written", attempts: 0, stageError: null, status: "DRAFT", ...(["banner", "split", "photo", "statement"].includes(layout) ? { imageLayout: layout } : {}) },
  });
  await db.socialFeedback.create({ data: { projectId: post.projectId, postId, kind: "regenerate_image", note } });
  await finishPost(postId);
  if (note) learn(post.projectId);
  refresh();
}

/** Same photo, another design (no AI cost). */
export async function relayoutAction(postId: string, layout: string) {
  await requireSuperAdmin();
  if (!["banner", "split", "photo", "statement"].includes(layout)) return;
  await db.socialPost.updateMany({ where: { id: postId, photo: { not: null } }, data: { imageLayout: layout, stage: "written" } });
  await finishPost(postId);
  refresh();
}

export async function deletePostAction(postId: string) {
  await requireSuperAdmin();
  await db.socialPost.deleteMany({ where: { id: postId, status: { notIn: ["PUBLISHED", "PUBLISHING"] } } });
  refresh();
}
