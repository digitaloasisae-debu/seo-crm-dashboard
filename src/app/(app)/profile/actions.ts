"use server";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/session";

export type ProfileState = { ok?: string; error?: string } | null;
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function updateProfileAction(_prev: ProfileState, fd: FormData): Promise<ProfileState> {
  const user = await requireUser();
  const name = s(fd, "name");
  const email = s(fd, "email").toLowerCase();
  if (!name) return { error: "Name can't be empty." };
  if (!z.string().email().safeParse(email).success) return { error: "That email doesn't look right." };
  if (email !== user.email) {
    const taken = await db.user.findUnique({ where: { email } });
    if (taken) return { error: "Another account already uses that email." };
    const me = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await bcrypt.compare(s(fd, "currentPassword"), me.passwordHash))) return { error: "To change your email, enter your current password." };
  }
  await db.user.update({ where: { id: user.id }, data: { name, email } });
  await logActivity({ actorId: user.id, action: "profile.update", entity: "user", entityId: user.id, after: { name, emailChanged: email !== user.email } });
  revalidatePath("/", "layout");
  return { ok: email !== user.email ? "Saved. Use your new email next time you sign in." : "Saved." };
}

export async function changePasswordAction(_prev: ProfileState, fd: FormData): Promise<ProfileState> {
  const user = await requireUser();
  const current = s(fd, "currentPassword");
  const next = String(fd.get("newPassword") ?? "");
  if (next.length < 10) return { error: "The new password needs at least 10 characters." };
  if (next !== String(fd.get("confirmPassword") ?? "")) return { error: "The two new passwords don't match." };
  const me = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await bcrypt.compare(current, me.passwordHash))) return { error: "Your current password is wrong." };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, 12) } });
  await logActivity({ actorId: user.id, action: "profile.password_change", entity: "user", entityId: user.id });
  return { ok: "Password changed." };
}
