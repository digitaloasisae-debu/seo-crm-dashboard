import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Badge, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import type { Issue, PsiSummary } from "@/lib/audit";
import { runAuditAction } from "./actions";
import { RunButton } from "./run-button";

export const maxDuration = 60;

const sevColor = { error: "red", warning: "yellow", notice: "gray" } as const;

function scoreColor(n: number | null | undefined) {
  if (n == null) return "text-slate-400";
  return n >= 90 ? "text-emerald-600" : n >= 50 ? "text-amber-600" : "text-red-600";
}

function Psi({ label, p }: { label: string; p: PsiSummary | null }) {
  if (!p) return null;
  const cell = (name: string, v: number | null) => (
    <div className="text-center"><div className={`text-2xl font-semibold ${scoreColor(v)}`}>{v ?? "—"}</div><div className="text-xs text-slate-500">{name}</div></div>
  );
  return (
    <div className="rounded border border-slate-200 p-4">
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
      <section className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">Site audit</h2>
          <p className="text-sm text-slate-500">PageSpeed for the home page, plus on-page checks on up to 25 pages from the sitemap.</p>
          {last?.status === "FAILED" && <p className="mt-1 text-sm text-red-700">Last run failed: {last.error}</p>}
        </div>
        {editable && <form action={runAuditAction.bind(null, id)}><RunButton label={latest ? "Run again" : "Run first audit"} /></form>}
      </section>

      {!latest ? <Empty>No audit yet.</Empty> : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="card text-center">
              <div className="text-sm text-slate-500">Health score</div>
              <div className={`text-5xl font-bold ${scoreColor(latest.score)}`}>{latest.score}</div>
              <div className="mt-1 text-xs text-slate-500">{latest.pagesChecked} pages checked · {fmtDate(latest.finishedAt)}</div>
              <div className="mt-3 flex justify-center gap-2 text-xs"><Badge color="red">{counts.error} errors</Badge><Badge color="yellow">{counts.warning} warnings</Badge><Badge>{counts.notice} notices</Badge></div>
            </div>
            <div className="md:col-span-2 space-y-4">
              <Psi label="Mobile" p={latest.psiMobile as unknown as PsiSummary | null} />
              <Psi label="Desktop" p={latest.psiDesktop as unknown as PsiSummary | null} />
            </div>
          </section>

          <section className="card p-0">
            <h2 className="p-4 pb-2 font-semibold">Issues to fix</h2>
            {issues.length === 0 ? <p className="p-4 pt-0 text-sm text-slate-500">Nothing found. Nice.</p> : (
              <ul className="divide-y divide-slate-100">
                {issues.map((i) => (
                  <li key={i.code} className="px-4 py-3">
                    <details>
                      <summary className="flex cursor-pointer items-center gap-3 text-sm">
                        <Badge color={sevColor[i.severity]}>{i.severity}</Badge>
                        <span className="flex-1">{i.title}</span>
                        <span className="text-slate-500">{i.count} {i.count === 1 ? "page" : "pages"}</span>
                      </summary>
                      <ul className="mt-2 space-y-0.5 pl-2 text-xs break-all text-slate-600">
                        {i.urls.map((u) => <li key={u}><a className="hover:underline" href={u.split(" (on ")[0]} target="_blank" rel="noreferrer">{u}</a></li>)}
                        {i.count > i.urls.length && <li>…and {i.count - i.urls.length} more</li>}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
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
