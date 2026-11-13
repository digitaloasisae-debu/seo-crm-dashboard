import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import { fmtDate } from "@/lib/utils";
import { startProspectAction } from "./actions";

export const maxDuration = 300;

export default async function ProspectPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireUser();
  const { err } = await searchParams;
  const list = await db.prospectAudit.findMany({ orderBy: { startedAt: "desc" }, take: 30, select: { id: true, domain: true, name: true, status: true, score: true, startedAt: true } });
  const country = process.env.DATAFORSEO_DEFAULT_COUNTRY || "United States";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Audit any website</h1>
        <p className="text-sm text-slate-500">For sales meetings and new clients. Enter any website and get a report with page screenshots, the problems found, and how we can help, in about 1–2 minutes. It doesn&apos;t need Google Analytics, Search Console or Business Profile access.</p>
      </div>
      <form action={startProspectAction} className="card grid gap-3 md:grid-cols-2">
        <label className="md:col-span-2"><span className="label">Website</span><input name="url" required className="input" placeholder="example.com" autoFocus /></label>
        <label><span className="label">Business name <span className="font-normal text-slate-400">(optional, to find their Google listing)</span></span><input name="name" className="input" placeholder="Smith Plumbing" /></label>
        <label><span className="label">City <span className="font-normal text-slate-400">(optional)</span></span><input name="city" className="input" placeholder="Dubai" /></label>
        <label><span className="label">Main service keyword <span className="font-normal text-slate-400">(optional, checks their Google position)</span></span><input name="keyword" className="input" placeholder="emergency plumber" /></label>
        <label><span className="label">Country</span><input name="country" className="input" defaultValue={country} /></label>
        {err && <p className="text-sm text-red-700 md:col-span-2">{err}</p>}
        <div className="md:col-span-2"><SubmitButton className="btn-primary inline-flex items-center gap-1.5"><Icon name="search" className="h-4 w-4" /> Run audit</SubmitButton></div>
      </form>
      {list.length > 0 && (
        <section className="card p-0">
          <h2 className="p-4 pb-2 font-semibold">Past audits</h2>
          <table className="table">
            <thead><tr><th>Website</th><th>Score</th><th>Date</th><th></th></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td><Link className="text-indigo-600 hover:underline" href={`/prospect/${p.id}`}>{p.name ? `${p.name} · ` : ""}{p.domain}</Link></td>
                  <td className="num">{p.status === "DONE" ? p.score ?? "—" : <span className="text-xs text-slate-500">{p.status.toLowerCase()}</span>}</td>
                  <td className="text-sm text-slate-500">{fmtDate(p.startedAt)}</td>
                  <td className="text-right"><Link className="text-xs text-indigo-600 hover:underline" href={`/prospect/${p.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
