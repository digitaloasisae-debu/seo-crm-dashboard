"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireClientAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { collectRankTask, queueRankChecks } from "@/lib/rank";

const back = (id: string, q = "") => redirect(`/clients/${id}/rankings${q ? `?${q}` : ""}`);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function addRankKeywordsAction(clientId: string, fd: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  const list = [...new Set(String(fd.get("keywords") ?? "").split(/[\n,]/).map((k) => k.trim().toLowerCase()).filter((k) => k.length > 1 && k.length < 120))];
  const picked = fd.getAll("pick").map(String);
  const all = [...new Set([...list, ...picked])];
  if (!all.length) back(clientId, "err=Type at least one keyword");
  const have = await db.rankKeyword.count({ where: { clientId } });
  const room = Math.max(0, 200 - have);
  const add = all.slice(0, room);
  await db.rankKeyword.createMany({ data: add.map((keyword) => ({ clientId, keyword })), skipDuplicates: true });
  let q = `added=${add.length}`;
  try {
    const fresh = await db.rankKeyword.findMany({ where: { clientId, keyword: { in: add }, checkedAt: null, pendingTask: null }, select: { id: true } });
    if (fresh.length) await queueRankChecks(clientId, { ids: fresh.map((f) => f.id), priority: 2 });
  } catch (e) {
    q += `&err=${encodeURIComponent(msg(e))}`;
  }
  back(clientId, q);
}

export async function removeRankKeywordAction(clientId: string, id: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  await db.rankKeyword.deleteMany({ where: { id, clientId } });
  back(clientId);
}

export async function checkRanksNowAction(clientId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  let q = "";
  try {
    const pending = await db.rankKeyword.findMany({ where: { clientId, pendingTask: { not: null } }, select: { pendingTask: true } });
    for (const p of pending) await collectRankTask(p.pendingTask!).catch(() => false);
    const ids = (await db.rankKeyword.findMany({ where: { clientId, pendingTask: null }, select: { id: true } })).map((k) => k.id);
    q = `queued=${await queueRankChecks(clientId, { ids, priority: 2 })}`;
  } catch (e) {
    q = `err=${encodeURIComponent(msg(e))}`;
  }
  back(clientId, q);
}

export async function saveRankLocationAction(clientId: string, fd: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  await db.client.update({ where: { id: clientId }, data: { rankLocation: String(fd.get("location") ?? "").trim().slice(0, 120) || null } });
  back(clientId, "saved=1");
}
