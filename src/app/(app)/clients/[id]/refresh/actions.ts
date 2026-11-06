"use server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireClientAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { applyRefresh, draftRefresh, findRefreshes } from "@/lib/refresh";

const back = (id: string, q = "") => redirect(`/clients/${id}/refresh${q ? `?${q}` : ""}`);

export async function scanRefreshAction(clientId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const n = await findRefreshes(clientId);
  back(clientId, `scanned=${n}`);
}

export async function draftRefreshAction(clientId: string, refreshId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  await db.contentRefresh.update({ where: { id: refreshId }, data: { error: null, status: "OPEN", brief: Prisma.DbNull, updatedAt: new Date() } });
  after(() => draftRefresh(refreshId));
  back(clientId, `drafting=${refreshId}`);
}

export async function applyRefreshAction(clientId: string, refreshId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const r = await db.contentRefresh.findUniqueOrThrow({ where: { id: refreshId } });
  if (r.articleId) await db.article.update({ where: { id: r.articleId }, data: { revisingAt: new Date(), reviseError: null } });
  after(async () => {
    await applyRefresh(refreshId, user.id).catch((e) => db.contentRefresh.update({ where: { id: refreshId }, data: { error: e instanceof Error ? e.message : String(e) } }));
  });
  back(clientId, `applying=${refreshId}`);
}

export async function setRefreshStatusAction(clientId: string, refreshId: string, status: "DONE" | "DISMISSED" | "OPEN") {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  await db.contentRefresh.update({ where: { id: refreshId }, data: { status } });
  back(clientId);
}
