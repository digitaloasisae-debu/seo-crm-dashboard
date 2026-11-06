import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { SubmitButton } from "@/components/submit-button";
import { fmtDate } from "@/lib/utils";
import { directoryLinks, hoursText, type GbpAi, type GbpFinding, type GbpInfo } from "@/lib/gbp";
import { addGbpAction, deleteGbpAction, refreshGbpAction, renameGbpAction } from "./actions";

export const maxDuration = 120;

const SEV: Record<GbpFinding["severity"], string> = { error: "✕ text-red-700", warning: "⚠ text-amber-700", info: "ⓘ text-slate-600", ok: "✓ text-emerald-700" };
const PRI: Record<string, string> = { P1: "text-red-700", P2: "text-amber-700", P3: "text-sky-700" };

export default async function GbpPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params;
  const { err } = await searchParams;
  const user = await requireUser();
  const [editable, profiles] = await Promise.all([canEdit(user, id), db.gbpProfile.findMany({ where: { clientId: id }, orderBy: { createdAt: "asc" } })]);
  return (
    <div className="space-y-6">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Google Business Profile audit</h2>
            <p className="text-sm text-slate-500">Checks each Google Maps listing: claimed status, reviews, categories, hours, photos, description, website link and whether the name, address and phone match the website. It goes into the full audit PDF on the Site audit tab.</p>
          </div>
          {editable && profiles.length > 0 && <form action={refreshGbpAction.bind(null, id)}><SubmitButton className="btn-secondary">🔄 Re-check all profiles</SubmitButton></form>}
        </div>
        {err && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
        {editable && (
          <form action={addGbpAction.bind(null, id)} className="grid gap-2 md:grid-cols-[10rem_1fr_auto]">
            <input name="label" placeholder="Location, e.g. Oakland" className="input" />
            <input name="query" required placeholder="Google Maps link of the listing (or its CID / place ID / exact business name)" className="input" />
            <SubmitButton className="btn-primary">＋ Add profile</SubmitButton>
          </form>
        )}
        <p className="text-xs text-slate-500">💡 To get the link: search the business on Google Maps, open the listing, click <b>Share → Copy link</b>, and paste it here. Add one per location.</p>
      </section>

      {profiles.map((p) => {
        const info = p.data as unknown as GbpInfo | null;
        const findings = (p.findings as unknown as GbpFinding[] | null) ?? [];
        const ai = p.ai as unknown as GbpAi | null;
        const issues = findings.filter((f) => f.severity !== "ok");
        return (
          <section key={p.id} className="card space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">📍 {p.label}</h2>
              {info?.is_claimed != null && <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${info.is_claimed ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}>{info.is_claimed ? "Claimed" : "Not claimed"}</span>}
              {info?.rating?.value != null && <span className="text-sm">⭐ <b>{info.rating.value}</b> <span className="text-slate-500">({info.rating.votes_count ?? 0} reviews)</span></span>}
              <span className="flex-1" />
              {p.fetchedAt && <span className="text-xs text-slate-400">checked {fmtDate(p.fetchedAt)}</span>}
              {editable && (
                <details className="relative text-xs">
                  <summary className="cursor-pointer text-slate-500 hover:text-slate-800">Edit</summary>
                  <div className="absolute right-0 z-10 mt-1 w-64 space-y-2 rounded-xl bg-white p-3 shadow-lg ring-1 ring-slate-200">
                    <form action={renameGbpAction.bind(null, id, p.id)} className="flex gap-1"><input name="label" defaultValue={p.label} className="input flex-1 text-xs" /><SubmitButton className="btn-secondary text-xs">Save</SubmitButton></form>
                    <form action={deleteGbpAction.bind(null, id, p.id)}><SubmitButton className="text-xs text-red-600 hover:underline">Remove this profile</SubmitButton></form>
                  </div>
                </details>
              )}
            </div>
            {p.error && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{p.error}</p>}
            {!info ? <p className="text-sm text-slate-500">No data yet.</p> : (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <table className="table text-sm">
                    <tbody>
                      {([
                        ["Business name", info.title],
                        ["Address", info.address],
                        ["Phone", info.phone],
                        ["Website", info.url ? <a key="u" href={info.url} target="_blank" rel="noreferrer" className="break-all text-indigo-600 hover:underline">{info.url}</a> : "—"],
                        ["Primary category", info.category],
                        ["Other categories", (info.additional_categories ?? []).join(", ") || "—"],
                        ["Hours", hoursText(info) || "—"],
                        ["Photos", info.total_photos ?? "—"],
                        ["Description", info.description ? `${info.description.length} characters` : "—"],
                        ["Services", (info.services ?? []).map((s) => s.title).filter(Boolean).slice(0, 12).join(", ") || "—"],
                        ["Attributes", Object.values(info.attributes?.available_attributes ?? {}).flat().slice(0, 8).join(", ").replace(/_/g, " ") || "—"],
                        ["Coordinates", info.latitude != null ? `${info.latitude}, ${info.longitude}` : "—"],
                        ["Place ID", info.place_id ?? "—"],
                        ["CID", info.cid ?? "—"],
                      ] as [string, React.ReactNode][]).map(([k, v]) => <tr key={k}><td className="w-36 text-xs font-medium text-slate-500">{k}</td><td className="text-xs">{v ?? "—"}</td></tr>)}
                    </tbody>
                  </table>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1 font-semibold">Findings</div>
                      <ul className="space-y-1.5 text-sm">
                        {findings.map((f, i) => { const [icon, cls] = SEV[f.severity].split(" "); return <li key={i} className="flex gap-2"><span className={cls}>{icon}</span><span><span className={`font-medium ${cls}`}>{f.title}</span>{f.detail && <span className="block text-xs text-slate-500">{f.detail}</span>}</span></li>; })}
                      </ul>
                      {issues.length === 0 && <p className="text-sm text-emerald-700">No problems found.</p>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">{directoryLinks(info).map((l) => <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="rounded-full bg-slate-50 px-2.5 py-1 text-indigo-700 ring-1 ring-slate-200 hover:bg-indigo-50">{l.label} ↗</a>)}</div>
                    {(info.people_also_search?.length ?? 0) > 0 && (
                      <div className="text-xs"><div className="mb-1 font-medium text-slate-600">Competitors Google shows next to this listing</div>
                        <ul className="space-y-0.5">{info.people_also_search!.slice(0, 6).map((c, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{c.title}</span><span className="shrink-0 text-slate-500">⭐ {c.rating?.value ?? "—"} · {c.rating?.votes_count ?? 0} reviews</span></li>)}</ul>
                      </div>
                    )}
                  </div>
                </div>
                {ai && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl bg-red-50/60 p-3 text-sm ring-1 ring-red-100"><div className="mb-1 font-semibold text-red-800">Issue description</div>{ai.description.map((d, i) => <p key={i} className="mb-1">{d}</p>)}</div>
                    <div className="rounded-xl bg-emerald-50/60 p-3 text-sm ring-1 ring-emerald-100"><div className="mb-1 font-semibold text-emerald-800">How to fix</div>{ai.fix.map((d, i) => <p key={i} className="mb-1">{d}</p>)}</div>
                    {ai.actions.length > 0 && (
                      <table className="table text-sm md:col-span-2">
                        <thead><tr><th className="w-16">Priority</th><th>Action</th><th>Benefit</th></tr></thead>
                        <tbody>{ai.actions.map((a, i) => <tr key={i}><td className={`font-bold ${PRI[a.priority]}`}>{a.priority}</td><td>{a.action}</td><td className="text-slate-500">{a.benefit}</td></tr>)}</tbody>
                      </table>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
