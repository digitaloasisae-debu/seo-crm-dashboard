"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireClientAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { importFromWordPress } from "@/lib/wp-import";

export async function importWordPressAction(clientId: string, formData: FormData) {
  const user = await requireUser();
  await requireClientAccess(user, clientId, "edit");
  let q = "";
  try {
    const r = await importFromWordPress(clientId, { pages: formData.get("pages") === "on", actorId: user.id });
    q = `imported=${r.added}&synced=${r.updated}${r.partial ? "&partial=1" : ""}`;
  } catch (e) {
    q = `importErr=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`;
  }
  revalidatePath(`/clients/${clientId}/articles`);
  redirect(`/clients/${clientId}/articles?${q}`);
}
