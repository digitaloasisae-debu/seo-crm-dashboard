import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Badge, Empty, ScoreRing } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtDate } from "@/lib/utils";
import type { Issue, PsiSummary, Shot } from "@/lib/audit";
import Link from "next/link";
import { Findings, findingsFromIssues, Screenshots } from "@/components/audit-report";
import { runAuditAction } from "./actions";
import { RunButton } from "./run-button";
import { SearchPerformance } from "./search-performance";

export const maxDuration = 300;

function scoreColor(n: number | null | undefined) {
  if (n == null) return "text-slate-400";
  return n >= 90 ? "text-emerald-600" : n >= 50 ? "text-amber-600" : "text-red-600";
}

function Psi({ label, p }: { label: string; p: PsiSummary | null }) {
  if (!p) return null;
  const cell = (name: string, v: number | null) => (
    <div className="text-center"><ScoreRing score={v} size={64} /><div className="mt-1 text-xs text-slate-500">{name}</div></div>
  );
  return (
    <div className="card">
      <div className="mb-3 text-sm font-medium">{label}</div>
      {p.error ? <p className="text-sm text-amber-700">{p.error}</p> : (
        <>
          <div className="grid grid-cols-4 gap-2">{cell("Performance", p.performance)}{cell("SEO", p.seo)}{cell("Accessibility", p.accessibility)}{cell("Best practices", p.bestPractices)}</div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 md:grid-cols-4">
            <span>LCP {p.lcpMs != null ? `${(p.lcpMs / 1000).toFixed(1)}s` : "—"}</span>
            <span>CLS {p.cls != null ? p.cls.toFixed(2) : "—"}</span>
            <span>TBT {p.tbtMs != null ? `${Math.round(p.tbtMs)}ms` : "—"}</span>
            <span>FCP {p.fcpMs != null ? `${(p.fcpMs / 1000).toFixed(1)}s` : "—"}</span>
          </div>
        </>
      )}
    </div>
  );
}

export default async function ClientSeo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [editable, audits] = await Promise.all([
    canEdit(user, id),
    db.siteAudit.findMany({ where: { clientId: id }, orderBy: { startedAt: "desc" }, take: 12 }),
  ]);
  const latest = audits.find((a) => a.status === "DONE");
  const last = audits[0];
  const issues = (latest?.issues as unknown as Issue[] | null) ?? [];
  const counts = { error: 0, warning: 0, notice: 0 };
  issues.forEach((i) => (counts[i.severity] += 1));

  return (
    <div className="space-y-6">
      <SearchPerformance clientId={id} editable={editable} />
      <section className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500"><Icon name="search" className="h-4 w-4" /></span>Quick SEO check</h2>
          <p className="text-sm text-slate-500">PageSpeed with screenshots of the home page and 3 key pages, plus on-page checks on up to 25 pages from the sitemap.</p>
          {last?.status === "FAILED" && <p className="mt-1 text-sm text-red-700">Last run failed: {last.error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {latest && <Link href={`/clients/${id}/seo/report`} className="btn-secondary inline-flex items-center gap-1.5"><Icon name="file" className="h-4 w-4" /> Client report</Link>}
          {editable && <form action={runAuditAction.bind(null, id)}><RunButton label={latest ? "Run again" : "Run first audit"} /></form>}
        </div>
      </section>

      {!latest ? <Empty>No audit yet.</Empty> : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="card text-center">
              <div className="mb-3 text-xs font-medium text-slate-500">Health score</div>
              <ScoreRing score={latest.score} />
              <div className="mt-1 text-xs text-slate-500">{latest.pagesChecked} pages checked · {fmtDate(latest.finishedAt)}</div>
              <div className="mt-3 flex justify-center gap-2 text-xs"><Badge color="red">{counts.error} errors</Badge><Badge color="yellow">{counts.warning} warnings</Badge><Badge>{counts.notice} notices</Badge></div>
            </div>
            <div className="md:col-span-2 space-y-4">
              <Psi label="Mobile" p={latest.psiMobile as unknown as PsiSummary | null} />
              <Psi label="Desktop" p={latest.psiDesktop as unknown as PsiSummary | null} />
            </div>
          </section>

          <Screenshots shots={(latest.shots as unknown as Shot[] | null) ?? []} />
          <Findings findings={findingsFromIssues(issues, latest.pagesChecked)} />
        </>
      )}

      {audits.length > 1 && (
        <section className="card p-0">
          <h2 className="p-4 pb-2 font-semibold">History</h2>
          <table className="table">
            <thead><tr><th>Date</th><th>Score</th><th>Pages</th><th>Mobile perf.</th><th>Status</th></tr></thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDate(a.startedAt)}</td>
                  <td className={scoreColor(a.score)}>{a.score ?? "—"}</td>
                  <td>{a.pagesChecked}</td>
                  <td className={scoreColor((a.psiMobile as unknown as PsiSummary | null)?.performance)}>{(a.psiMobile as unknown as PsiSummary | null)?.performance ?? "—"}</td>
                  <td className="text-xs text-slate-500">{a.status.toLowerCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
