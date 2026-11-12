"use server";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import type { Prisma } from "@prisma/client";
import { PLATFORMS, draftServiceCard, planMonth, planReplacement, updateBrain, writeDesignText } from "@/lib/social/ai";
import { PICTURE_FORMATS, designOf, formatOf, isFormat } from "@/lib/social/formats";
import { addMedia, describeMedia, nextMedia } from "@/lib/social/media";
import { cleanHandles, runResearch } from "@/lib/social/research";
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

// ---------- competitor research ----------

export async function saveCompetitorsAction(projectId: string, formData: FormData) {
  await requireSuperAdmin();
  const competitors = cleanHandles(String(formData.get("competitors") ?? "").split(/[\s,]+/));
  await db.socialProject.update({ where: { id: projectId }, data: { competitors } });
  if (formData.get("run") === "1") {
    let err = "";
    try { await runResearch(projectId); } catch (e) { err = msg(e); }
    redirect(`/social/projects/${projectId}/research${err ? `?err=${encodeURIComponent(err)}` : "?done=1"}`);
  }
  redirect(`/social/projects/${projectId}/research?saved=1`);
}

// ---------- photo library ----------

/** One photo per call (the browser resizes and sends them one by one). */
export async function uploadMediaAction(projectId: string, formData: FormData) {
  await requireSuperAdmin();
  const file = formData.get("photo");
  if (!(file instanceof Blob) || !file.size) return { ok: false, error: "No photo" };
  if (file.size > 4_500_000) return { ok: false, error: "Photo too large" };
  try {
    const m = await addMedia(projectId, Buffer.from(await file.arrayBuffer()));
    after(() => describeMedia(m.id));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  } finally {
    revalidatePath(`/social/projects/${projectId}/photos`);
  }
}

export async function saveMediaAction(mediaId: string, formData: FormData) {
  await requireSuperAdmin();
  const m = await db.socialMedia.update({ where: { id: mediaId }, data: { description: String(formData.get("description") ?? "").trim().slice(0, 600) } });
  revalidatePath(`/social/projects/${m.projectId}/photos`);
}

export async function deleteMediaAction(mediaId: string) {
  await requireSuperAdmin();
  const m = await db.socialMedia.delete({ where: { id: mediaId } });
  revalidatePath(`/social/projects/${m.projectId}/photos`);
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

/** Re-render a ready post's image now (after a text, format or look change). */
async function redraw(postId: string) {
  await db.socialPost.updateMany({ where: { id: postId, stage: "ready" }, data: { stage: "written" } });
  await finishPost(postId);
}

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
  // Image text of a text-first format.
  const format = formatOf(post.imageLayout);
  const design = designOf(post.design);
  const designText = f.get("designText");
  let designChanged = false;
  if (designText !== null && !PICTURE_FORMATS.includes(format) && String(designText).trim() !== (design.texts?.[format] ?? "").trim()) {
    designChanged = true;
    await db.socialPost.update({ where: { id: postId }, data: { design: { ...design, texts: { ...design.texts, [format]: String(designText).trim().slice(0, 2000) } } as Prisma.InputJsonValue } });
  }
  if (!Object.keys(data).length) return { post, headline: designChanged };
  await db.socialPost.update({ where: { id: postId }, data });
  const edits = FIELD_KEYS.filter((k) => k in data && k.startsWith("caption"));
  if (edits.length) {
    await db.socialFeedback.createMany({ data: edits.map((k) => ({ projectId: post.projectId, postId, kind: "edit", note: k.replace("caption", "").toLowerCase() + " caption", before: post[k], after: data[k] ?? "" })) });
  }
  const headline = designChanged || (["headlineTop", "headlineMain", "headlineBottom"] as const).some((k) => k in data);
  return { post, headline, learned: edits.length > 0 };
}

export async function savePostAction(postId: string, formData: FormData) {
  await requireSuperAdmin();
  const { post, headline, learned } = await saveEdits(postId, formData);
  if (headline) await redraw(postId);
  if (learned) learn(post.projectId);
  refresh();
}

export async function approvePostAction(postId: string, formData: FormData) {
  await requireSuperAdmin();
  const { post, headline, learned } = await saveEdits(postId, formData);
  if (headline) await redraw(postId);
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

/**
 * A new picture. mode "library" = the next photo from the project's library (photo format),
 * mode "ai" = a new AI picture for the post's format, concept visual or photo (with Hamza's note).
 * Keeps the captions.
 */
export async function regenerateImageAction(postId: string, formData: FormData) {
  await requireSuperAdmin();
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  const mode = String(formData.get("mode") ?? "ai");
  const cur = await db.socialPost.findUniqueOrThrow({ where: { id: postId }, select: { projectId: true, mediaId: true, imageLayout: true } });
  const pictureFormat = formatOf(cur.imageLayout) === "concept" ? "concept" : "photo";
  if (mode === "library") {
    const m = await nextMedia(cur.projectId, cur.mediaId);
    if (!m) return;
    await db.socialPost.update({ where: { id: postId }, data: { mediaId: m.id, imageLayout: "photo", stage: "written", attempts: 0, stageError: null, status: "DRAFT" } });
    await db.socialMedia.update({ where: { id: m.id }, data: { usedCount: { increment: 1 } } });
  } else {
    await db.socialPost.update({ where: { id: postId }, data: { imageNote: note || null, photo: null, mediaId: null, imageLayout: pictureFormat, stage: "written", attempts: 0, stageError: null, status: "DRAFT" } });
    await db.socialFeedback.create({ data: { projectId: cur.projectId, postId, kind: "regenerate_image", note } });
    if (note) learn(cur.projectId);
  }
  await finishPost(postId);
  refresh();
}

/** Same words, a different look (colours and fonts). No AI cost. */
export async function anotherLookAction(postId: string) {
  await requireSuperAdmin();
  const post = await db.socialPost.findUniqueOrThrow({ where: { id: postId }, select: { design: true } });
  const d = designOf(post.design);
  await db.socialPost.update({ where: { id: postId }, data: { design: { ...d, variant: (d.variant ?? 0) + 1 } as Prisma.InputJsonValue } });
  await redraw(postId);
  refresh();
}

/** Switch the image format. Writes the image text for a format the post has none for yet. */
export async function relayoutAction(postId: string, format: string) {
  await requireSuperAdmin();
  if (!isFormat(format)) return;
  const post = await db.socialPost.findUniqueOrThrow({ where: { id: postId } });
  const d = designOf(post.design);
  const data: Prisma.SocialPostUpdateInput = { imageLayout: format };
  if (format === "photo") {
    if (!post.mediaId) {
      const m = await nextMedia(post.projectId);
      if (m) data.media = { connect: { id: m.id } };
      // No library photo: the worker makes an AI photo.
    }
  } else if (format === "concept") {
    data.media = { disconnect: true };
  } else if (!d.texts?.[format]) {
    const text = await writeDesignText(post, format).catch(() => "");
    if (text) data.design = { ...d, texts: { ...d.texts, [format]: text } } as Prisma.InputJsonValue;
  }
  await db.socialPost.update({ where: { id: postId }, data });
  await redraw(postId);
  refresh();
}

export async function deletePostAction(postId: string) {
  await requireSuperAdmin();
  await db.socialPost.deleteMany({ where: { id: postId, status: { notIn: ["PUBLISHED", "PUBLISHING"] } } });
  refresh();
}
