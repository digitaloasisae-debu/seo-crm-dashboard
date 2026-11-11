import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { SubmitButton } from "@/components/submit-button";
import { geminiConfigured } from "@/lib/gemini";
import { brandProfileText } from "@/lib/brand-profile";
import { fmtDate } from "@/lib/utils";
import { draftBrandProfileAction, saveBrandProfileAction } from "./actions";

export const maxDuration = 120;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label mb-0">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export default async function BrandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; drafted?: string; err?: string }> }) {
  const { id } = await params;
  const { saved, drafted, err } = await searchParams;
  const user = await requireUser();
  const [p, editable] = await Promise.all([db.brandProfile.findUnique({ where: { clientId: id } }), canEdit(user, id)]);
  const ai = geminiConfigured();
  const preview = brandProfileText(p);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="card space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Brand profile</h2>
            <p className="text-sm text-slate-500">How this client writes. n8n and every AI writer in Rankflow (rewrites, SOP fixes, refreshes, Google posts, review replies) follow it.</p>
            {p && <p className="mt-1 text-xs text-slate-400">Last updated {fmtDate(p.updatedAt)}</p>}
          </div>
          {editable && ai && (
            <form action={draftBrandProfileAction.bind(null, id)}>
              <SubmitButton className="btn-secondary">{p ? "Redraft from website" : "Draft from website"}</SubmitButton>
            </form>
          )}
        </div>
        {saved && <p className="rounded-lg bg-emerald-50 p-2.5 text-sm text-emerald-800">Saved. New articles will follow this profile.</p>}
        {drafted && <p className="rounded-lg bg-indigo-50 p-2.5 text-sm text-indigo-800">Drafted from the website. Check it, fix anything wrong and save.</p>}
        {err && <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">Couldn&apos;t draft: {err}</p>}

        <form action={saveBrandProfileAction.bind(null, id)} className="grid gap-4 md:grid-cols-2">
          <fieldset disabled={!editable} className="contents">
            <div className="md:col-span-2"><Field label="Voice" hint="1–2 sentences. How does the brand sound?"><textarea className="input" name="voice" rows={2} defaultValue={p?.voice ?? ""} placeholder="Friendly local experts who explain things plainly, never pushy." /></Field></div>
            <div className="md:col-span-2"><Field label="Audience"><input className="input" name="audience" defaultValue={p?.audience ?? ""} placeholder="Homeowners in Houston with a broken gate who want it fixed today" /></Field></div>
            <Field label="Tone words" hint="Comma separated"><input className="input" name="toneWords" defaultValue={p?.toneWords.join(", ") ?? ""} placeholder="helpful, confident, local" /></Field>
            <Field label="Write as"><input className="input" name="person" defaultValue={p?.person ?? "we"} placeholder="we" /></Field>
            <Field label="Never use" hint="Words, phrases or claims. Comma or one per line"><textarea className="input" name="bannedWords" rows={3} defaultValue={p?.bannedWords.join("\n") ?? ""} placeholder={"cheapest\nguaranteed #1\ndelve"} /></Field>
            <Field label="Always mention" hint="Services, selling points, phrases"><textarea className="input" name="alwaysUse" rows={3} defaultValue={p?.alwaysUse.join("\n") ?? ""} placeholder={"same-day service\nlicensed and insured"} /></Field>
            <div className="md:col-span-2"><Field label="Facts about the business" hint="One per line. The AI uses only these and never invents others."><textarea className="input" name="facts" rows={4} defaultValue={p?.facts ?? ""} placeholder={"Family-owned since 2012\nServes Houston, Katy and Sugar Land\n2-year warranty on installs"} /></Field></div>
            <div className="md:col-span-2"><Field label="Example of their writing" hint="A paragraph from their site or a post they love."><textarea className="input" name="examples" rows={4} defaultValue={p?.examples ?? ""} /></Field></div>
            <Field label="Calls to action"><input className="input" name="ctaStyle" defaultValue={p?.ctaStyle ?? ""} placeholder="Invite readers to call for a free quote" /></Field>
            <Field label="Spelling">
              <select className="input" name="spelling" defaultValue={p?.spelling ?? "US"}><option value="US">American English</option><option value="UK">British English</option></select>
            </Field>
            {editable && <div className="md:col-span-2"><SubmitButton className="btn-primary">Save brand profile</SubmitButton></div>}
          </fieldset>
        </form>
      </section>

      <aside className="space-y-4">
        <section className="card">
          <h3 className="font-sans text-sm font-semibold tracking-normal">What the AI writers get</h3>
          {preview ? <pre className="mt-3 max-h-[32rem] overflow-auto rounded-xl bg-slate-50 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-700">{preview}</pre> : <p className="mt-2 text-sm text-slate-500">Nothing yet. Draft it from the website or fill it in.</p>}
          <p className="mt-3 text-xs text-slate-400">The client brain&apos;s learned rules are added after this. In n8n it arrives in the <code>brand_brain</code> field WF2 already uses, so no n8n change is needed.</p>
        </section>
      </aside>
    </div>
  );
}
