"use server";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
import { importSheet, readWorkbook, type ImportReport } from "@/lib/sheet-import";

export type ImportState = { report?: ImportReport; error?: string } | null;

export async function importSheetAction(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const user = await requireSuperAdmin();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the .xlsx file first." };
  if (!/\.xlsx$/i.test(file.name)) return { error: "Please upload the .xlsx file (Google Sheets: File → Download → Microsoft Excel)." };
  try {
    const tabs = await readWorkbook(await file.arrayBuffer());
    const report = await importSheet(tabs, { commit: fd.get("mode") === "import", actorId: user.id });
    if (report.mode === "import") revalidatePath("/", "layout");
    return { report };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
