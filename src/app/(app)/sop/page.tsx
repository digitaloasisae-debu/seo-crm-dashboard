import { requireSuperAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DEFAULT_SOP, getSop } from "@/lib/sop";
import { saveSopAction } from "../../actions";

export default async function SopPage() {
  await requireSuperAdmin();
  const [sop, custom] = await Promise.all([getSop(), db.appSetting.findUnique({ where: { key: "sop" } })]);
  return (
    <>
      <PageHeader title="Content SOP" subtitle="Every article is checked against this. Measurable rules are checked by code; the rest by the AI review." />
      <form action={saveSopAction} className="card space-y-3">
        <textarea className="input font-mono text-xs leading-5" name="sop" rows={30} defaultValue={sop} />
        <div className="flex items-center gap-3">
          <SubmitButton className="btn-primary">Save SOP</SubmitButton>
          <span className="text-xs text-slate-500">{custom ? "Using your edited version. Clear the box and save to go back to the original." : "Using the original SOP."}</span>
        </div>
        <input type="hidden" name="_default_len" value={DEFAULT_SOP.length} />
      </form>
    </>
  );
}
