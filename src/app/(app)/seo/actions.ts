"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { getAgency, saveAgency } from "@/lib/report-brand";

/** Agency name, website, reply-to email and logo used on every client report. */
export async function saveBrandingAction(formData: FormData) {
  await requireAdmin();
  const cur = await getAgency();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80) || cur.name;
  let website = String(formData.get("website") ?? "").trim().slice(0, 200);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  const email = String(formData.get("email") ?? "").trim().slice(0, 200);
  if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) redirect(`/seo?err=${encodeURIComponent("That reply-to email doesn't look right")}#branding`);
  let logo = cur.logo;
  const file = formData.get("logo");
  if (formData.get("removeLogo") === "on") logo = null;
  else if (file instanceof File && file.size > 0) {
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) redirect(`/seo?err=${encodeURIComponent("The logo must be a PNG or JPG file")}#branding`);
    if (file.size > 400_000) redirect(`/seo?err=${encodeURIComponent("The logo must be under 400 KB")}#branding`);
    logo = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
  }
  await saveAgency({ name, website, email, logo });
  redirect("/seo?saved=1#branding");
}
