"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireClientAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { addLink, suggestLinks } from "@/lib/links";

async function guard(articleId: string) {
  const user = await requireUser();
  const a = await db.article.findUniqueOrThrow({ where: { id: articleId }, select: { clientId: true } });
  await requireClientAccess(user, a.clientId, "edit");
  return user;
}
const back = (id: string, q = "") => redirect(`/articles/${id}${q ? `?${q}` : ""}#links`);

export async function suggestLinksAction(articleId: string) {
  await guard(articleId);
  let q = "";
  try {
    q = `links=${await suggestLinks(articleId)}`;
  } catch (e) {
    q = `linkErr=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`;
  }
  back(articleId, q);
}

export async function addLinksAction(articleId: string, fd: FormData) {
  const user = await guard(articleId);
  const ids = fd.getAll("ids").map(String);
  for (const id of ids) {
    const l = await db.internalLink.findFirst({ where: { id, articleId } });
    if (l) await addLink(l.id, user.id);
  }
  back(articleId);
}

export async function dismissLinkAction(articleId: string, linkId: string) {
  await guard(articleId);
  await db.internalLink.updateMany({ where: { id: linkId, articleId }, data: { status: "DISMISSED" } });
  back(articleId);
}
