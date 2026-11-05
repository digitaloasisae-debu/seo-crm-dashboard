"use server";
import { revalidatePath } from "next/cache";
import { requireClientAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { syncAnalytics } from "@/lib/analytics";

export async function syncAnalyticsAction(clientId: string) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  try {
    await syncAnalytics(clientId);
  } catch {
    // Saved on the client (ga4Error) and shown on the page.
  }
  revalidatePath(`/clients/${clientId}/analytics`);
}
