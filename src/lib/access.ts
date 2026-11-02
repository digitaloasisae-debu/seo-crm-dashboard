import type { AccessLevel, Prisma } from "@prisma/client";
import { db } from "./db";
import type { SessionUser } from "./session";

// Role decides what a person may do; client_assignments decide on which clients.
// SUPER_ADMIN: every client. ADMIN and MEMBER: only clients they own or were granted.

export type Need = "view" | "edit";

function activeAssignmentWhere(userId: string): Prisma.ClientAssignmentWhereInput {
  return { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
}

/** Prisma filter for the clients this user can see. */
export function clientScope(user: SessionUser, need: Need = "view"): Prisma.ClientWhereInput {
  if (user.role === "SUPER_ADMIN") return {};
  const levels: AccessLevel[] = need === "edit" ? ["OWNER", "EDIT"] : ["OWNER", "EDIT", "VIEW"];
  return { assignments: { some: { ...activeAssignmentWhere(user.id), access: { in: levels } } } };
}

export async function accessLevel(user: SessionUser, clientId: string): Promise<AccessLevel | "SUPER" | null> {
  if (user.role === "SUPER_ADMIN") return "SUPER";
  const a = await db.clientAssignment.findFirst({ where: { clientId, ...activeAssignmentWhere(user.id) } });
  return a?.access ?? null;
}

export async function canEdit(user: SessionUser, clientId: string): Promise<boolean> {
  const level = await accessLevel(user, clientId);
  return level === "SUPER" || level === "OWNER" || level === "EDIT";
}

export async function requireClientAccess(user: SessionUser, clientId: string, need: Need = "view") {
  const level = await accessLevel(user, clientId);
  const ok = level === "SUPER" || level === "OWNER" || level === "EDIT" || (need === "view" && level === "VIEW");
  if (!ok) throw new Error("You don't have access to this client");
  return level!;
}
