import Link from "next/link";
import { db } from "@/lib/db";
import { searchPerformance } from "@/lib/gsc-report";
import { fmtDate } from "@/lib/utils";
import { Badge } from "@/components/ui";
import { syncGscAction } from "../../../google/actions";
import { RunButton } from "./run-button";

function Delta({ cur, prev, invert = false, pct = false, digits = 0 }: { cur: number; prev: number | null | undefined; invert?: boolean; pct?: boolean; digits?: number }) {
  if (prev == null) return null;
  const d = cur - prev;
  if (Math.abs(d) < (digits ? 0.05 : 0.5)) return <span className="text-xs text-slate-400">no change</span>;
  const good = invert ? d < 0 : d > 0;
  const shown = pct ? `${(d * 100).toFixed(1)} pts` : d.toFixed(digits);
  return <span className={`text-xs ${good ? "text-emerald-600" : "text-red-600"}`}>{d > 0 ? "+" : ""}{shown}</span>;
}

function Chart({ daily }: { daily: { date: Date; clicks: number; impressions: number }[] }) {
  if (daily.length < 2) return null;
  const W = 800, H = 140, P = 4;
  const maxC = Math.max(1, ...daily.map((d) => d.clicks));
  const maxI = Math.max(1, ...daily.map((d) => d.impressions));
  const x = (i: number) => P + (i * (W - 2 * P)) / (daily.length - 1);
  const line = (vals: number[], max: number) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${(H - P - (v / max) * (H - 2 * P)).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" preserveAspectRatio="none" role="img" aria-label="Daily clicks and impressions">
        <path d={line(daily.map((d) => d.impressions), maxI)} fill="none" stroke="#a78bfa" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <defs>
          <linearGradient id="gscFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line(daily.map((d) => d.clicks), maxC)} L${W},${H} L0,${H} Z`} fill="url(#gscFill)" className="animate-fade-in" />
        <path d={line(daily.map((d) => d.clicks), maxC)} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-xs text-slate-500">
        <span>{fmtDate(daily[0].date)}</span>
        <span><span className="text-indigo-600">■</span> clicks (max {maxC}) · <span className="text-violet-400">■</span> impressions (max {maxI})</span>
        <span>{fmtDate(daily.at(-1)!.date)}</span>
      </div>
    </div>
  );
}

export async function SearchPerformance({ clientId, editable }: { clientId: string; editable: boolean }) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { gscProperty: true, gscSyncedAt: true, gscError: true } });
  if (!client.gscProperty) {
    return (
      <section className="card">
        <h2 className="font-semibold">Keyword performance</h2>
        <p className="mt-1 text-sm text-slate-500">Not linked to Google Search Console yet. The Super Admin links it on the <Link className="text-indigo-600 hover:underline" href="/google">Google</Link> page.</p>
      </section>
    );
  }
  const { daily, totals, prevTotals, queries, pages } = await searchPerformance(clientId);
  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Keyword performance</h2>
            <p className="text-sm text-slate-500">Google Search Console · {client.gscProperty} · {client.gscSyncedAt ? `updated ${fmtDate(client.gscSyncedAt)}` : "not synced yet"}</p>
            {client.gscError && <p className="mt-1 text-sm text-red-700">{client.gscError}</p>}
          </div>
          {editable && <form action={syncGscAction.bind(null, clientId)}><RunButton label={client.gscSyncedAt ? "Refresh now" : "Load data"} pendingLabel="Loading Search Console…" /></form>}
        </div>
        {daily.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/60 p-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-indigo-500/10"><div className="text-xs font-medium text-slate-500">Clicks (28 days)</div><div className="text-2xl font-bold tracking-tight tabular-nums">{totals.clicks}</div><Delta cur={totals.clicks} prev={prevTotals?.clicks} /></div>
              <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/60 p-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-indigo-500/10"><div className="text-xs font-medium text-slate-500">Impressions</div><div className="text-2xl font-bold tracking-tight tabular-nums">{totals.impressions}</div><Delta cur={totals.impressions} prev={prevTotals?.impressions} /></div>
              <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/60 p-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-indigo-500/10"><div className="text-xs font-medium text-slate-500">CTR</div><div className="text-2xl font-bold tracking-tight tabular-nums">{(totals.ctr * 100).toFixed(1)}%</div><Delta cur={totals.ctr} prev={prevTotals?.ctr} pct digits={1} /></div>
              <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/60 p-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-indigo-500/10"><div className="text-xs font-medium text-slate-500">Avg. position</div><div className="text-2xl font-bold tracking-tight tabular-nums">{totals.position.toFixed(1)}</div><Delta cur={totals.position} prev={prevTotals?.position} invert digits={1} /></div>
            </div>
            <Chart daily={daily} />
          </>
        )}
      </section>

      {queries.length > 0 && (
        <section className="card p-0">
          <h2 className="p-4 pb-1 font-semibold">Top queries (last 4 weeks)</h2>
          <p className="px-4 pb-2 text-xs text-slate-500">Change compares with the 4 weeks before. A lower position number is better. &quot;pool&quot; means the keyword is in this client&apos;s keyword pool.</p>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Query</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th><th>Change</th></tr></thead>
              <tbody>
                {queries.slice(0, 50).map((q) => {
                  const d = q.prevPosition != null ? q.prevPosition - q.position : null;
                  return (
                    <tr key={q.query}>
                      <td>{q.query} {q.inPool && <Badge color="indigo">pool</Badge>}</td>
                      <td>{q.clicks}</td>
                      <td>{q.impressions}</td>
                      <td>{(q.ctr * 100).toFixed(1)}%</td>
                      <td>{q.position.toFixed(1)}</td>
                      <td className={d == null ? "text-xs text-slate-400" : d > 0.5 ? "text-emerald-600" : d < -0.5 ? "text-red-600" : "text-slate-400"}>{d == null ? "new" : Math.abs(d) <= 0.5 ? "–" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pages.length > 0 && (
        <section className="card p-0">
          <h2 className="p-4 pb-2 font-semibold">Top pages (28 days)</h2>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Page</th><th>Clicks</th><th>Impressions</th><th>Position</th></tr></thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.page}>
                    <td className="max-w-md truncate"><a className="text-indigo-600 hover:underline" href={p.page} target="_blank" rel="noreferrer">{p.page.replace(/^https?:\/\/[^/]+/, "") || "/"}</a></td>
                    <td>{p.clicks}</td><td>{p.impressions}</td><td>{p.position.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
