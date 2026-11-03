import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "./db";

export type SessionUser = Pick<User, "id" | "name" | "email" | "role">;

/** The signed-in user, re-read from the database so role changes and deactivation apply immediately. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") throw new Error("Only admins can do this");
  return user;
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") throw new Error("Only the Super Admin can do this");
  return user;
}
