import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ScoreRing } from "@/components/ui";
import { RefreshWhile } from "@/components/refresh-while";
import { Spinner } from "@/components/spinner";
import { PrintButton } from "@/components/print-button";
import { Findings, Screenshots, SpeedScores } from "@/components/audit-report";
import { fmtDate } from "@/lib/utils";
import type { ProspectResult } from "@/lib/prospect";
import { deleteProspectAction } from "../actions";

const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US"));

function Fact({ label, value, sub, bad }: { label: string; value: React.ReactNode; sub?: string; bad?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`num mt-0.5 text-xl font-semibold ${bad ? "text-red-600" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default async function ProspectReport({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const p = await db.prospectAudit.findUnique({ where: { id } });
  if (!p) notFound();
  const stuck = p.status === "RUNNING" && Date.now() - p.startedAt.getTime() > 6 * 60_000;
  if (p.status === "RUNNING" && !stuck) {
    return (
      <div className="card flex items-center gap-3 text-sm">
        <RefreshWhile ms={6000} />
        <Spinner className="h-5 w-5 text-indigo-600" />
        <div><b>Auditing {p.domain}…</b> Crawling pages, taking screenshots with Google PageSpeed, and checking Google visibility and backlinks. This takes 1–2 minutes and the page updates by itself.</div>
      </div>
    );
  }
  const r = p.result as unknown as ProspectResult | null;
  if (p.status !== "DONE" || !r) {
    return <div className="card space-y-2 text-sm"><p className="text-red-700">The audit didn&apos;t finish: {stuck ? "it took too long" : p.error}</p><Link className="text-indigo-600 hover:underline" href="/prospect">← Try again</Link></div>;
  }
  const ssl = r.ssl;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link className="text-sm text-indigo-600 hover:underline" href="/prospect">← All website audits</Link>
        <div className="flex items-center gap-2">
          <PrintButton />
          <form action={deleteProspectAction.bind(null, p.id)}><button className="btn-secondary text-red-600">Delete</button></form>
        </div>
      </div>

      <header className="card flex flex-wrap items-center gap-6">
        <ScoreRing score={r.score} size={110} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Website audit</div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">{p.name || p.domain}</h1>
          <p className="text-sm text-slate-600"><a className="hover:underline" href={r.url} target="_blank" rel="noreferrer">{p.domain}</a> · {r.pagesChecked} pages checked · {fmtDate(p.finishedAt)}</p>
          {r.summary && <p className="pt-1 text-sm leading-6 text-slate-700">{r.summary}</p>}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Fact label="Keywords on Google" value={n(r.organic?.keywords)} sub={r.organic ? `${n(r.organic.top10)} on page one` : "No data"} bad={r.organic != null && (r.organic.keywords ?? 0) < 50} />
        <Fact label="Visits a month from Google" value={n(r.organic?.traffic)} sub="DataForSEO estimate" />
        <Fact label="Websites linking to it" value={n(r.backlinks?.referringDomains)} sub={r.backlinks ? `${n(r.backlinks.backlinks)} links · authority ${n(r.backlinks.authority)}/100` : "No data"} bad={r.backlinks != null && (r.backlinks.referringDomains ?? 0) < 20} />
        <Fact label="Mobile speed" value={n(r.psiMobile?.performance)} sub="Google PageSpeed, out of 100" bad={(r.psiMobile?.performance ?? 100) < 50} />
        <Fact label="Google Business listing" value={r.google ? (r.google.listing ? "Found" : "Not found") : "—"} sub={r.google?.listing ? `${r.google.listing.rating ? `${r.google.listing.rating}★, ` : ""}${n(r.google.listing.reviews)} reviews` : r.google ? `Searched "${r.google.query}"` : undefined} bad={r.google != null && !r.google.listing} />
        <Fact label="Website for its own name" value={r.google ? (r.google.ownRank ? `#${r.google.ownRank}` : "Not in top 20") : "—"} sub={r.google ? `"${r.google.query}"` : undefined} bad={r.google != null && !r.google.ownRank} />
        <Fact label="Domain age" value={r.domainAge.years != null ? `${r.domainAge.years} yrs` : "—"} sub={r.domainAge.registered ? `Registered ${r.domainAge.registered.slice(0, 10)}` : r.domainAge.firstArchived ? `First archived ${r.domainAge.firstArchived}` : undefined} />
        <Fact label="SSL certificate" value={ssl ? (ssl.valid ? "Valid" : "Problem") : "—"} sub={ssl?.expires ? `Expires ${ssl.expires.slice(0, 10)}${ssl.issuer ? ` · ${ssl.issuer}` : ""}` : ssl?.error} bad={ssl != null && (!ssl.valid || (ssl.daysLeft ?? 99) < 21)} />
      </section>

      <Screenshots shots={r.shots ?? []} />
      <Findings findings={r.findings} />

      {r.keywordCheck && (
        <section className="card space-y-2 print:break-inside-avoid">
          <h2 className="font-semibold">Google results for &ldquo;{r.keywordCheck.keyword}&rdquo;</h2>
          <p className="text-sm text-slate-600">{p.domain} is {r.keywordCheck.position ? <b>#{r.keywordCheck.position}</b> : <b>not in the top 20</b>}.</p>
          <ol className="space-y-1 text-sm">{r.keywordCheck.top.map((t) => <li key={t.position + t.domain}><span className="num inline-block w-7 text-slate-500">#{t.position}</span><b>{t.domain}</b> <span className="text-slate-500">{t.title}</span></li>)}</ol>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {r.topKeywords.length > 0 && (
          <section className="card p-0 print:break-inside-avoid">
            <h2 className="p-4 pb-2 font-semibold">Biggest keywords it ranks for</h2>
            <table className="table"><thead><tr><th>Keyword</th><th className="text-right">Position</th><th className="text-right">Searches/mo</th></tr></thead>
              <tbody>{r.topKeywords.map((k) => <tr key={k.keyword}><td>{k.keyword}</td><td className="num text-right">{k.position ?? "—"}</td><td className="num text-right">{n(k.volume)}</td></tr>)}</tbody></table>
          </section>
        )}
        {r.competitors.length > 0 && (
          <section className="card p-0 print:break-inside-avoid">
            <h2 className="p-4 pb-2 font-semibold">Competitors on Google</h2>
            <table className="table"><thead><tr><th>Website</th><th className="text-right">Keywords</th><th className="text-right">Visits/mo</th></tr></thead>
              <tbody>
                <tr className="bg-indigo-50/50"><td className="font-medium">{p.domain}</td><td className="num text-right">{n(r.organic?.keywords)}</td><td className="num text-right">{n(r.organic?.traffic)}</td></tr>
                {r.competitors.map((c) => <tr key={c.domain}><td>{c.domain}</td><td className="num text-right">{n(c.keywords)}</td><td className="num text-right">{n(c.traffic)}</td></tr>)}
              </tbody></table>
          </section>
        )}
      </div>

      <SpeedScores mobile={r.psiMobile} desktop={r.psiDesktop} />
      <p className="text-xs text-slate-500">Sources: our crawl of {r.pagesChecked} pages, Google PageSpeed Insights, Google search results and DataForSEO (keywords, traffic estimates, backlinks), RDAP and archive.org (domain age), and the site&apos;s SSL certificate. {r.notes.length > 0 && <span className="print:hidden">Missing: {r.notes.join("; ")}</span>}</p>
    </div>
  );
}
