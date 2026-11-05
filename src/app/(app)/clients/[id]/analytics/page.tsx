import Link from "next/link";
import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { SubmitButton } from "@/components/submit-button";
import { fmtDate } from "@/lib/utils";
import { syncAnalytics, type Ga4Data, type Ga4Totals } from "@/lib/analytics";
import { matchArticleSlug } from "@/lib/gsc-report";
import { syncAnalyticsAction } from "./actions";

export const maxDuration = 60;

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const slugOf = (path: string) => path.toLowerCase().split("?")[0].replace(/\/+$/, "").split("/").pop() ?? "";

function Change({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  if (!before) return <span className="text-xs text-slate-400">no earlier data</span>;
  const d = (now - before) / before;
  const good = invert ? d < 0 : d > 0;
  if (Math.abs(d) < 0.005) return <span className="text-xs text-slate-400">same as before</span>;
  return <span className={`text-xs font-semibold ${good ? "text-emerald-600" : "text-red-600"}`}>{d > 0 ? "▲" : "▼"} {Math.abs(d * 100).toFixed(0)}% vs prev. 28d</span>;
}

function Tile({ label, value, now, before, help }: { label: string; value: string; now: number; before: number; help?: string }) {
  return (
    <div className="card p-4" title={help}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      <Change now={now} before={before} />
    </div>
  );
}

function Daily({ days }: { days: Ga4Data["daily"] }) {
  if (days.length < 2) return null;
  const max = Math.max(1, ...days.map((d) => d.sessions));
  const W = 900, H = 140, bw = W / days.length;
  return (
    <section className="card">
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <h2 className="font-semibold">Visits per day, last 90 days</h2>
        <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2 w-3 rounded-sm bg-indigo-400" />visits</span>
        <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-500" />days with conversions</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 8}`} className="h-40 w-full" preserveAspectRatio="none">
        {days.map((d, i) => {
          const h = Math.max(1, (d.sessions / max) * H);
          return (
            <g key={d.date}>
              <rect x={i * bw + 0.5} y={H - h + 8} width={Math.max(1, bw - 1.5)} height={h} rx={1.5} className="fill-indigo-400"><title>{`${d.date}: ${d.sessions} visits, ${d.keyEvents} conversions`}</title></rect>
              {d.keyEvents > 0 && <circle cx={i * bw + bw / 2} cy={Math.max(4, H - h + 2)} r={2.5} className="fill-emerald-500" />}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[11px] text-slate-400"><span>{days[0].date}</span><span>{days.at(-1)!.date}</span></div>
    </section>
  );
}

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [editable, client] = await Promise.all([
    canEdit(user, id),
    db.client.findUniqueOrThrow({ where: { id }, select: { siteUrl: true, ga4PropertyId: true, ga4PropertyName: true, ga4SyncedAt: true, ga4Error: true, analytics: true } }),
  ]);
  let snap = client.analytics;
  let error = client.ga4Error;
  // Refresh automatically when the numbers are more than 12 hours old.
  if (client.ga4PropertyId && (!snap || Date.now() - snap.fetchedAt.getTime() > 12 * 3600_000)) {
    try {
      const data = await syncAnalytics(id);
      snap = { clientId: id, data: data as never, fetchedAt: new Date() };
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const isAdmin = user.role === "SUPER_ADMIN";

  if (!client.ga4PropertyId) {
    return (
      <section className="card space-y-2">
        <h2 className="font-semibold">Google Analytics isn&apos;t linked for this client yet</h2>
        <p className="text-sm text-slate-600">Once it&apos;s linked you&apos;ll see visits, visitors, conversions, traffic channels and the best landing pages here, plus Google visits and conversions on every published post.</p>
        {isAdmin ? (
          <p className="text-sm">Go to the <Link href="/google" className="font-medium text-indigo-600 hover:underline">Google page</Link> and pick this client&apos;s Analytics property (or press &quot;Auto-match&quot;).</p>
        ) : <p className="text-sm text-slate-500">Ask the super admin to link it on the Google page.</p>}
      </section>
    );
  }

  const d = snap?.data as unknown as Ga4Data | undefined;
  const articles = d ? await db.article.findMany({ where: { clientId: id, status: "PUSHED_DRAFT" }, select: { id: true, slug: true, metaTitle: true, focusKeyword: true } }) : [];
  const organicSlugs = new Set((d?.organicPages ?? []).map((p) => slugOf(p.name)).filter(Boolean));
  const articleBySlug = new Map<string, (typeof articles)[number]>();
  const posts = articles.map((a) => {
    const s = matchArticleSlug(a, organicSlugs);
    if (s) articleBySlug.set(s, a);
    const rows = s ? d!.organicPages.filter((p) => slugOf(p.name) === s) : [];
    return { a, sessions: rows.reduce((t, r) => t + r.sessions, 0), keyEvents: rows.reduce((t, r) => t + r.keyEvents, 0), users: rows.reduce((t, r) => t + r.users, 0) };
  }).sort((x, y) => y.sessions - x.sessions);
  const withVisits = posts.filter((p) => p.sessions > 0);
  const noVisits = posts.filter((p) => p.sessions === 0);
  const cur = d?.current as Ga4Totals, prev = d?.previous as Ga4Totals;
  const convRate = (t: Ga4Totals) => (t.sessions ? t.keyEvents / t.sessions : 0);
  const chMax = Math.max(1, ...(d?.channels ?? []).map((c) => c.sessions));

  return (
    <div className="space-y-6">
      <section className="card flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Google Analytics · {client.ga4PropertyName ?? client.ga4PropertyId}</h2>
          <p className="text-sm text-slate-500">Last 28 days compared with the 28 days before.{snap && <> Updated {fmtDate(snap.fetchedAt)}.</>}</p>
          {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        </div>
        {editable && <form action={syncAnalyticsAction.bind(null, id)}><SubmitButton className="btn-secondary">🔄 Refresh</SubmitButton></form>}
      </section>

      {d && (
        <>
          <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Visits (sessions)" value={fmt(cur.sessions)} now={cur.sessions} before={prev.sessions} />
            <Tile label="Visitors" value={fmt(cur.users)} now={cur.users} before={prev.users} />
            <Tile label="New visitors" value={fmt(cur.newUsers)} now={cur.newUsers} before={prev.newUsers} />
            <Tile label="Conversions" value={fmt(cur.keyEvents)} now={cur.keyEvents} before={prev.keyEvents} help="GA4 key events: calls, form sends, bookings… whatever is marked as a key event in Analytics." />
            <Tile label="Conversion rate" value={pct(convRate(cur))} now={convRate(cur)} before={convRate(prev)} />
            <Tile label="Engagement rate" value={pct(cur.engagementRate)} now={cur.engagementRate} before={prev.engagementRate} />
          </section>

          <Daily days={d.daily} />

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="card">
              <h2 className="mb-3 font-semibold">Where visitors come from</h2>
              <div className="space-y-2.5">
                {d.channels.map((c) => (
                  <div key={c.name} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-3 text-sm">
                    <span className={`truncate ${c.name === "Organic Search" ? "font-semibold text-indigo-700" : ""}`}>{c.name}</span>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${c.name === "Organic Search" ? "bg-indigo-500" : "bg-slate-400"}`} style={{ width: `${Math.max(2, (c.sessions / chMax) * 100)}%` }} /></div>
                    <span className="w-36 text-right text-xs text-slate-500">{fmt(c.sessions)} visits · {fmt(c.keyEvents)} conv.</span>
                  </div>
                ))}
                {d.channels.length === 0 && <p className="text-sm text-slate-500">No visits in the last 28 days.</p>}
              </div>
            </div>
            <div className="card">
              <h2 className="mb-3 font-semibold">Conversions by type</h2>
              {d.events.length === 0 ? (
                <p className="text-sm text-slate-500">No conversions recorded. In Google Analytics, mark the actions that matter (form sent, phone click, booking) as <b>key events</b> so they count here.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {d.events.map((e) => <li key={e.name} className="flex justify-between py-1.5"><code className="text-xs">{e.name}</code><span className="font-semibold tabular-nums">{fmt(e.count)}</span></li>)}
                </ul>
              )}
            </div>
          </section>

          {posts.length > 0 && (
            <section className="card p-0">
              <div className="p-4 pb-2">
                <h2 className="font-semibold">Our blog posts: visits from Google</h2>
                <p className="text-xs text-slate-500">Organic search visits and conversions in the last 28 days for posts pushed from Rankflow. {withVisits.length} of {posts.length} posts got visits from Google.</p>
              </div>
              {withVisits.length > 0 && (
                <table className="table">
                  <thead><tr><th>Post</th><th>Visits</th><th>Visitors</th><th>Conversions</th></tr></thead>
                  <tbody>
                    {withVisits.map(({ a, sessions, users, keyEvents }) => (
                      <tr key={a.id}>
                        <td className="max-w-md"><Link href={`/articles/${a.id}`} className="block truncate text-indigo-600 hover:underline">{a.metaTitle}</Link></td>
                        <td className="font-semibold">{fmt(sessions)}</td>
                        <td>{fmt(users)}</td>
                        <td className={keyEvents ? "font-semibold text-emerald-700" : "text-slate-400"}>{fmt(keyEvents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {noVisits.length > 0 && (
                <details className="border-t border-slate-100">
                  <summary className="p-4 text-sm font-medium">{noVisits.length} post{noVisits.length === 1 ? "" : "s"} with no Google visits yet</summary>
                  <div className="px-4 pb-4 text-sm">
                    <p className="mb-2 text-xs text-slate-500">Usual reasons: the post is still a draft in WordPress (Rankflow pushes drafts, so someone has to press Publish), it was published less than 2–4 weeks ago, or it doesn&apos;t rank on page 1 yet. Check the post&apos;s Google ranking on its page.</p>
                    <ul className="space-y-1">{noVisits.map(({ a }) => <li key={a.id}><Link href={`/articles/${a.id}`} className="text-indigo-600 hover:underline">{a.metaTitle}</Link></li>)}</ul>
                  </div>
                </details>
              )}
            </section>
          )}

          <section className="card p-0">
            <h2 className="p-4 pb-2 font-semibold">Top landing pages (all channels)</h2>
            {d.pages.length === 0 ? <p className="p-4 pt-0 text-sm text-slate-500">No data.</p> : (
              <table className="table">
                <thead><tr><th>Page</th><th>Visits</th><th>Visitors</th><th>Conversions</th><th>Engaged</th></tr></thead>
                <tbody>
                  {d.pages.slice(0, 25).map((p) => {
                    const art = articleBySlug.get(slugOf(p.name));
                    return (
                      <tr key={p.name}>
                        <td className="max-w-md truncate text-sm">
                          <code className="text-xs">{p.name === "(not set)" ? "(not set)" : p.name || "/"}</code>
                          {art && <Link href={`/articles/${art.id}`} className="ml-2 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-200 ring-inset">our post</Link>}
                        </td>
                        <td>{fmt(p.sessions)}</td><td>{fmt(p.users)}</td>
                        <td className={p.keyEvents ? "font-semibold text-emerald-700" : "text-slate-400"}>{fmt(p.keyEvents)}</td>
                        <td className="text-xs">{p.engagementRate != null ? pct(p.engagementRate) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
