"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AccessLevel, Prisma, Role } from "@prisma/client";
import { signIn, signOut } from "@/auth";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { logActivity } from "@/lib/activity";
import { canEdit, requireClientAccess } from "@/lib/access";
import { requireSuperAdmin, requireUser } from "@/lib/session";
import { addKeywords, processSubmission } from "@/lib/intake";
import { ensureSlots } from "@/lib/posting";
import { pushArticle, testConnection } from "@/lib/wordpress";
import { triggerN8n } from "@/lib/n8n";
import { toSafeHtml } from "@/lib/content";
import { slugify, splitList, stripTrailingSlash } from "@/lib/utils";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const ids = (fd: FormData) => fd.getAll("ids").map(String).filter(Boolean);

// ---------- Auth ----------

export async function loginAction(_prev: string | null, fd: FormData): Promise<string | null> {
  try {
    await signIn("credentials", { email: str(fd, "email").toLowerCase(), password: str(fd, "password"), redirectTo: "/" });
    return null;
  } catch (e) {
    // signIn throws a redirect on success; let it through.
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    return "Wrong email or password";
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

// ---------- Clients ----------

function clientFields(fd: FormData) {
  return {
    name: str(fd, "name"),
    siteUrl: stripTrailingSlash(str(fd, "siteUrl")),
    businessType: str(fd, "businessType") || null,
    targetCountry: str(fd, "targetCountry") || null,
    primaryCity: str(fd, "primaryCity") || null,
    serviceAreaCities: splitList(str(fd, "serviceAreaCities")),
    servicesOffered: splitList(str(fd, "servicesOffered")),
    targetAudience: str(fd, "targetAudience") || null,
    competitors: splitList(str(fd, "competitors")),
    brandVoiceAvoid: str(fd, "brandVoiceAvoid") || null,
    ctaText: str(fd, "ctaText") || null,
    ctaLink: str(fd, "ctaLink") || null,
    postsPerMonth: Number(str(fd, "postsPerMonth")) || 0,
    preferredDates: splitList(str(fd, "preferredDates")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    imageRequired: fd.get("imageRequired") === "on",
    imageStyle: str(fd, "imageStyle") || null,
    cmsPlatform: str(fd, "cmsPlatform") || null,
    linkPool: splitList(str(fd, "linkPool")),
    socialLinks: splitList(str(fd, "socialLinks")),
    masterTemplateUrl: str(fd, "masterTemplateUrl") || null,
    gscAccount: str(fd, "gscAccount") || null,
    brandPrimaryColor: str(fd, "brandPrimaryColor") || null,
    brandSecondaryColor: str(fd, "brandSecondaryColor") || null,
    brandAccentColor: str(fd, "brandAccentColor") || null,
    logoUrl: str(fd, "logoUrl") || null,
    autoApproveKeywords: fd.get("autoApproveKeywords") === "on",
  };
}

export async function createClientAction(fd: FormData) {
  const user = await requireSuperAdmin();
  const data = clientFields(fd);
  if (!data.name || !data.siteUrl) throw new Error("Name and website URL are required");
  let slug = slugify(data.name) || "client";
  for (let i = 2; await db.client.findUnique({ where: { slug } }); i++) slug = `${slugify(data.name)}-${i}`;
  const client = await db.client.create({ data: { ...data, slug } });
  await logActivity({ actorId: user.id, clientId: client.id, action: "client.create", entity: "client", entityId: client.id });
  await ensureSlots(client.id);
  redirect(`/clients/${client.id}/settings`);
}

export async function updateClientAction(clientId: string, fd: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const before = await db.client.findUniqueOrThrow({ where: { id: clientId } });
  const data = clientFields(fd);
  const status = str(fd, "status");
  const after = await db.client.update({
    where: { id: clientId },
    data: { ...data, ...(user.role === "SUPER_ADMIN" && ["ACTIVE", "PAUSED", "ARCHIVED"].includes(status) ? { status: status as "ACTIVE" } : {}) },
  });
  await logActivity({ actorId: user.id, clientId, action: "client.update", entity: "client", entityId: clientId, before, after });
  await ensureSlots(clientId);
  revalidatePath(`/clients/${clientId}`, "layout");
}

export async function saveWordpressCredentialAction(clientId: string, fd: FormData) {
  const user = await requireSuperAdmin();
  const endpoint = stripTrailingSlash(str(fd, "endpoint"));
  const username = str(fd, "username");
  const password = str(fd, "password");
  if (!endpoint || !username) throw new Error("Endpoint and username are required");
  const existing = await db.clientCredential.findUnique({ where: { clientId_kind: { clientId, kind: "WORDPRESS" } } });
  if (!password && !existing) throw new Error("Application password is required");

  const sealed = password ? encryptSecret(password) : {};
  await db.clientCredential.upsert({
    where: { clientId_kind: { clientId, kind: "WORDPRESS" } },
    create: { clientId, kind: "WORDPRESS", endpoint, username, ...(sealed as ReturnType<typeof encryptSecret>) },
    update: { endpoint, username, ...sealed, lastVerifiedAt: null, lastError: null },
  });
  // The password itself is never logged.
  await logActivity({ actorId: user.id, clientId, action: "credential.save", entity: "client", entityId: clientId, after: { endpoint, username, passwordChanged: !!password } });
  revalidatePath(`/clients/${clientId}/settings`);
}

export async function testWordpressAction(clientId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  await testConnection(clientId);
  revalidatePath(`/clients/${clientId}/settings`);
}

export async function setAssignmentAction(clientId: string, fd: FormData) {
  const admin = await requireSuperAdmin();
  const userId = str(fd, "userId");
  const access = str(fd, "access") as AccessLevel | "REMOVE";
  const expires = str(fd, "expiresAt");
  if (!userId) throw new Error("Pick a team member");
  if (access === "REMOVE") {
    await db.clientAssignment.deleteMany({ where: { clientId, userId } });
  } else {
    const data = { access, grantedById: admin.id, expiresAt: expires ? new Date(`${expires}T23:59:59Z`) : null };
    await db.clientAssignment.upsert({
      where: { clientId_userId: { clientId, userId } },
      create: { clientId, userId, ...data },
      update: data,
    });
  }
  await logActivity({ actorId: admin.id, clientId, action: "assignment.set", entity: "client", entityId: clientId, after: { userId, access, expires } });
  revalidatePath(`/clients/${clientId}`, "layout");
}

// ---------- Keywords ----------

export async function addKeywordsAction(clientId: string, fd: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  await addKeywords(clientId, splitList(str(fd, "keywords")), {
    source: "MANUAL",
    submittedBy: user.name,
    actorId: user.id,
    category: str(fd, "category") || undefined,
  });
  revalidatePath(`/clients/${clientId}/keywords`);
}

export async function setKeywordStatusAction(clientId: string, status: "APPROVED" | "REJECTED" | "PENDING", fd: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const selected = ids(fd);
  if (!selected.length) return;
  await db.keyword.updateMany({
    where: { id: { in: selected }, clientId },
    data: { status, approvedById: status === "APPROVED" ? user.id : null },
  });
  await logActivity({ actorId: user.id, clientId, action: `keyword.${status.toLowerCase()}`, entity: "keyword", entityId: selected.join(","), after: { count: selected.length } });
  revalidatePath(`/clients/${clientId}/keywords`);
}

export async function deleteKeywordsAction(clientId: string, fd: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const selected = ids(fd);
  if (!selected.length) return;
  await db.keyword.deleteMany({ where: { id: { in: selected }, clientId, used: false } });
  await logActivity({ actorId: user.id, clientId, action: "keyword.delete", entity: "keyword", entityId: selected.join(",") });
  revalidatePath(`/clients/${clientId}/keywords`);
}

// ---------- Topics ----------

export async function setTopicStatusAction(clientId: string, status: "APPROVED" | "REJECTED", fd: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const selected = ids(fd);
  if (!selected.length) return;
  await db.topic.updateMany({
    where: { id: { in: selected }, clientId },
    data: { status, approvedById: status === "APPROVED" ? user.id : null, reviewNote: str(fd, "note") || null },
  });
  await logActivity({ actorId: user.id, clientId, action: `topic.${status.toLowerCase()}`, entity: "topic", entityId: selected.join(","), after: { count: selected.length } });
  revalidatePath(`/clients/${clientId}/topics`);
}

export async function editTopicAction(topicId: string, fd: FormData) {
  const user = await requireUser();
  const topic = await db.topic.findUniqueOrThrow({ where: { id: topicId } });
  await requireClientAccess(user, topic.clientId, "edit");
  const after = await db.topic.update({
    where: { id: topicId },
    data: { title: str(fd, "title"), angle: str(fd, "angle") || null, category: str(fd, "category") || null, status: "GENERATED" },
  });
  await logActivity({ actorId: user.id, clientId: topic.clientId, action: "topic.edit", entity: "topic", entityId: topicId, before: topic, after });
  revalidatePath(`/clients/${topic.clientId}/topics`);
}

export async function runN8nAction(clientId: string, which: "WF1" | "WF2") {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  await triggerN8n(which, { client_id: clientId, requested_by: user.email });
  await logActivity({ actorId: user.id, clientId, action: `n8n.trigger_${which.toLowerCase()}`, entity: "client", entityId: clientId });
  revalidatePath(`/clients/${clientId}`, "layout");
}

// ---------- Articles ----------

async function articleForEdit(articleId: string) {
  const user = await requireUser();
  const article = await db.article.findUniqueOrThrow({ where: { id: articleId } });
  await requireClientAccess(user, article.clientId, "edit");
  return { user, article };
}

export async function saveArticleAction(articleId: string, fd: FormData) {
  const { user, article } = await articleForEdit(articleId);
  if (["PUSHING", "PUSHED_DRAFT"].includes(article.status)) throw new Error("This article is already in WordPress; edit it there");
  const after = await db.article.update({
    where: { id: articleId },
    data: {
      metaTitle: str(fd, "metaTitle"),
      slug: slugify(str(fd, "slug") || str(fd, "metaTitle")),
      metaDescription: str(fd, "metaDescription") || null,
      focusKeyword: str(fd, "focusKeyword") || article.focusKeyword,
      featuredImageUrl: str(fd, "featuredImageUrl") || null,
      bodyHtml: toSafeHtml({ html: String(fd.get("bodyHtml") ?? "") }),
    },
  });
  await logActivity({ actorId: user.id, clientId: article.clientId, action: "article.edit", entity: "article", entityId: articleId, before: { metaTitle: article.metaTitle, slug: article.slug }, after: { metaTitle: after.metaTitle, slug: after.slug } });
  revalidatePath(`/articles/${articleId}`);
}

export async function reviewArticleAction(articleId: string, decision: "APPROVED" | "CHANGES_REQUESTED", fd: FormData) {
  const { user, article } = await articleForEdit(articleId);
  if (!["READY_FOR_REVIEW", "CHANGES_REQUESTED", "APPROVED"].includes(article.status)) {
    throw new Error(`Can't review an article that is ${article.status}`);
  }
  await db.article.update({
    where: { id: articleId },
    data: {
      status: decision,
      reviewNote: str(fd, "note") || null,
      approvedById: decision === "APPROVED" ? user.id : null,
      approvedAt: decision === "APPROVED" ? new Date() : null,
    },
  });
  await logActivity({ actorId: user.id, clientId: article.clientId, action: `article.${decision.toLowerCase()}`, entity: "article", entityId: articleId, after: { note: str(fd, "note") } });
  revalidatePath(`/articles/${articleId}`);
}

export async function pushArticleAction(articleId: string) {
  const { user } = await articleForEdit(articleId);
  try {
    await pushArticle(articleId, user.id);
  } catch {
    // The error is saved on the article (lastPushError) and shown on the review page.
  }
  revalidatePath(`/articles/${articleId}`);
}

// ---------- Intake ----------

export async function retrySubmissionAction(submissionId: string, fd: FormData) {
  const user = await requireUser();
  if (user.role === "MEMBER") throw new Error("Only admins can retry submissions");
  const submission = await db.formSubmission.findUniqueOrThrow({ where: { id: submissionId } });
  const clientId = str(fd, "clientId");
  if (submission.form === "KEYWORDS" && clientId) {
    // Fix an unmatched client name: point the stored payload at the chosen client's slug.
    const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    const payload = submission.payload as { data: { fields: { key: string; label: string | null; type: string; value: unknown }[] } };
    payload.data.fields = payload.data.fields.filter((f) => (f.label ?? "").toLowerCase() !== "client_slug");
    payload.data.fields.push({ key: "client_slug", label: "client_slug", type: "HIDDEN_FIELDS", value: client.slug });
    const json = payload as unknown as Prisma.InputJsonObject;
    await db.formSubmission.update({ where: { id: submissionId }, data: { payload: json } });
    submission.payload = json as Prisma.JsonObject;
  }
  await processSubmission(submission);
  revalidatePath("/intake");
}

// ---------- Users (Super Admin) ----------

export async function createUserAction(fd: FormData) {
  const admin = await requireSuperAdmin();
  const email = str(fd, "email").toLowerCase();
  const password = str(fd, "password");
  if (!email || password.length < 10) throw new Error("Email and a password of at least 10 characters are required");
  const user = await db.user.create({
    data: { name: str(fd, "name"), email, role: (str(fd, "role") || "MEMBER") as Role, passwordHash: await bcrypt.hash(password, 12) },
  });
  await logActivity({ actorId: admin.id, action: "user.create", entity: "user", entityId: user.id, after: { email, role: user.role } });
  revalidatePath("/users");
}

export async function updateUserAction(userId: string, fd: FormData) {
  const admin = await requireSuperAdmin();
  const role = str(fd, "role") as Role;
  const password = str(fd, "password");
  if (userId === admin.id && role !== "SUPER_ADMIN") throw new Error("You can't remove your own Super Admin role");
  await db.user.update({
    where: { id: userId },
    data: {
      role,
      active: userId === admin.id ? true : fd.get("active") === "on",
      ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
    },
  });
  await logActivity({ actorId: admin.id, action: "user.update", entity: "user", entityId: userId, after: { role, passwordReset: !!password } });
  revalidatePath("/users");
}

// ---------- Access requests ----------

export async function requestAccessAction(fd: FormData) {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("Only admins can request access to other clients");
  const clientId = str(fd, "clientId");
  if (await canEdit(user, clientId)) throw new Error("You already have access to this client");
  await db.accessRequest.create({
    data: { clientId, requesterId: user.id, access: str(fd, "access") === "EDIT" ? "EDIT" : "VIEW", reason: str(fd, "reason") || null },
  });
  revalidatePath("/access");
}

export async function decideAccessAction(requestId: string, approve: boolean, fd: FormData) {
  const admin = await requireSuperAdmin();
  const req = await db.accessRequest.findUniqueOrThrow({ where: { id: requestId } });
  const expires = str(fd, "expiresAt");
  const expiresAt = expires ? new Date(`${expires}T23:59:59Z`) : null;
  await db.$transaction(async (tx) => {
    await tx.accessRequest.update({
      where: { id: requestId },
      data: { status: approve ? "APPROVED" : "DENIED", decidedById: admin.id, decidedAt: new Date(), expiresAt },
    });
    if (approve) {
      const existing = await tx.clientAssignment.findUnique({ where: { clientId_userId: { clientId: req.clientId, userId: req.requesterId } } });
      // Never downgrade an owner.
      if (!existing || existing.access !== "OWNER") {
        await tx.clientAssignment.upsert({
          where: { clientId_userId: { clientId: req.clientId, userId: req.requesterId } },
          create: { clientId: req.clientId, userId: req.requesterId, access: req.access, grantedById: admin.id, expiresAt },
          update: { access: req.access, grantedById: admin.id, expiresAt },
        });
      }
    }
    await logActivity({ actorId: admin.id, clientId: req.clientId, action: approve ? "access.approve" : "access.deny", entity: "access_request", entityId: requestId }, tx);
  });
  revalidatePath("/access");
}
