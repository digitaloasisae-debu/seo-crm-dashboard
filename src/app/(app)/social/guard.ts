import { notFound } from "next/navigation";
import { currentUser } from "@/lib/session";

/** Social Studio pages are Super Admin only: anyone else gets a plain 404. (Layout and each page both check.) */
export async function superAdminOnly() {
  const user = await currentUser();
  if (!user || user.role !== "SUPER_ADMIN") notFound();
  return user;
}
