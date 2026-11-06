import Link from "next/link";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import type { Issue, PsiSummary } from "@/lib/audit";
import { getAgency } from "@/lib/report-brand";
import { SubmitButton } from "@/components/submit-button";
import { saveBrandingAction } from "./actions";

function tone(n: number | null | undefined) {
  if (n == null) return "text-slate-400";
  return n >= 90 ? "text-emerald-600" : n >= 50 ? "text-amber-600" : "text-red-600";
}

export default async function SeoOverview({ searchParams }: { searchParams: Promise<{ err?: string; saved?: string }> }) {
  const user = await requireUser();
  const { err, saved } = await searchParams;
  const admin = user.role === "SUPER_ADMIN" || user.role === "ADMIN";
  const agency = admin ? await getAgency() : null;
  const clients = await db.client.findMany({
    where: { ...clientScope(user), status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, audits: { where: { status: "DONE" }, orderBy: { startedAt: "desc" }, take: 2 } },
  });
  return (
    <>
      <PageHeader title="SEO" subtitle="Latest site audit for each client. Open a client to run a new one." />
      {clients.length === 0 ? <Empty>No clients.</Empty> : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Client</th><th>Health</th><th>Change</th><th>Mobile perf.</th><th>Errors</th><th>Last audit</th></tr></thead>
            <tbody>
              {clients.map((c) => {
                const [a, prev] = c.audits;
                const errors = ((a?.issues as unknown as Issue[] | null) ?? []).filter((i) => i.severity === "error").length;
                const delta = a?.score != null && prev?.score != null ? a.score - prev.score : null;
                return (
                  <tr key={c.id}>
                    <td><Link className="text-indigo-600 hover:underline" href={`/clients/${c.id}/seo`}>{c.name}</Link></td>
                    <td className={`font-semibold ${tone(a?.score)}`}>{a?.score ?? "—"}</td>
                    <td className={delta == null ? "text-slate-400" : delta >= 0 ? "text-emerald-600" : "text-red-600"}>{delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}</td>
                    <td className={tone((a?.psiMobile as unknown as PsiSummary | null)?.performance)}>{(a?.psiMobile as unknown as PsiSummary | null)?.performance ?? "—"}</td>
                    <td className={errors ? "text-red-600" : "text-slate-500"}>{a ? errors : "—"}</td>
                    <td className="text-slate-500">{a ? fmtDate(a.finishedAt) : "never"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {agency && (
        <section id="branding" className="card mt-6 scroll-mt-4">
          <h2 className="font-semibold">🎨 Report branding</h2>
          <p className="text-sm text-slate-500">Your agency&apos;s name and logo on every audit PDF and report email. The client&apos;s own logo and colour stay on the cover too.</p>
          {err && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
          {saved && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">Saved. New PDFs use it straight away.</p>}
          <form action={saveBrandingAction} className="mt-3 grid gap-4 text-sm md:grid-cols-2">
            <label className="space-y-1"><span className="font-medium">Agency name</span><input name="name" defaultValue={agency.name} className="input w-full" /></label>
            <label className="space-y-1"><span className="font-medium">Website</span><input name="website" defaultValue={agency.website} placeholder="digitaloasis.ae" className="input w-full" /></label>
            <label className="space-y-1"><span className="font-medium">Reply-to email for automatic reports</span><input name="email" defaultValue={agency.email} placeholder="you@gmail.com" className="input w-full" /><span className="block text-xs text-slate-500">When a client replies to a monthly report, it goes here.</span></label>
            <div className="space-y-1"><span className="font-medium">Logo (PNG or JPG, under 400 KB)</span>
              <div className="flex items-center gap-3">
                {agency.logo && <img src={agency.logo} alt="Agency logo" className="h-10 max-w-[140px] rounded bg-white object-contain p-1 ring-1 ring-slate-200" />}
                <input type="file" name="logo" accept="image/png,image/jpeg" className="text-xs" />
              </div>
              {agency.logo && <label className="flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" name="removeLogo" /> Remove logo</label>}
            </div>
            <div className="md:col-span-2"><SubmitButton className="btn-primary">Save branding</SubmitButton></div>
          </form>
        </section>
      )}
    </>
  );
}
