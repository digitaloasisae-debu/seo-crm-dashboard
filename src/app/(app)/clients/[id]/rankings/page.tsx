import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { SubmitButton } from "@/components/submit-button";
import { RankSparkline } from "@/components/ui";
import { RefreshWhile } from "@/components/refresh-while";
import { DataTable, type Col } from "@/components/data-table";
import { dataforseoConfigured } from "@/lib/dataforseo";
import { rankLocation, suggestRankKeywords } from "@/lib/rank";
import { addRankKeywordsAction, checkRanksNowAction, removeRankKeywordAction, saveRankLocationAction } from "./actions";

export const maxDuration = 120;

function Pos({ v, best }: { v: number | null; best?: boolean }) {
  if (v == null) return <span className="text-slate-400">30+</span>;
  const tone = v <= 3 ? "bg-emerald-50 text-emerald-700" : v <= 10 ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600";
  return <span className={`num inline-block min-w-9 rounded-lg px-2 py-0.5 text-center text-sm font-medium ${best ? "" : tone}`}>{v}</span>;
}

function Move({ now, prev, first }: { now: number | null; prev: number | null; first?: boolean }) {
  if (first) return <span className="text-xs text-slate-400">new</span>;
  const a = prev ?? 31, b = now ?? 31;
  const d = a - b;
  if (prev == null && now == null) return <span className="text-xs text-slate-300">–</span>;
  if (d === 0) return <span className="text-xs text-slate-400">–</span>;
  return <span className={`num text-xs font-semibold ${d > 0 ? "text-emerald-600" : "text-red-600"}`}>{d > 0 ? "▲" : "▼"} {Math.abs(d)}</span>;
}

export default async function RankingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; added?: string; queued?: string; saved?: string }> }) {
  const { id } = await params;
  const { err, added, queued, saved } = await searchParams;
  const user = await requireUser();
  const since = new Date(Date.now() - 30 * 864e5);
  const [editable, kws, client] = await Promise.all([
    canEdit(user, id),
    db.rankKeyword.findMany({ where: { clientId: id }, include: { checks: { where: { date: { gte: since } }, orderBy: { date: "asc" } } }, orderBy: [{ position: { sort: "asc", nulls: "last" } }, { keyword: "asc" }] }),
    db.client.findUniqueOrThrow({ where: { id }, select: { rankLocation: true } }),
  ]);
  const [loc, suggestions] = await Promise.all([rankLocation(id), editable ? suggestRankKeywords(id) : Promise.resolve([])]);
  const ready = dataforseoConfigured();
  const pending = kws.some((k) => k.pendingTask);
  const ranked = kws.filter((k) => k.position != null);
  const stats = [
    { label: "Tracked", value: kws.length },
    { label: "Top 3", value: kws.filter((k) => k.position != null && k.position <= 3).length },
    { label: "Top 10", value: kws.filter((k) => k.position != null && k.position <= 10).length },
    { label: "In the map pack", value: kws.filter((k) => k.mapPosition != null).length },
    { label: "Avg. position", value: ranked.length ? (ranked.reduce((a, k) => a + k.position!, 0) / ranked.length).toFixed(1) : "—" },
  ];
  const winners = kws.filter((k) => k.prevPosition != null || k.position != null).map((k) => ({ k, d: (k.prevPosition ?? 31) - (k.position ?? 31) })).filter((x) => x.d !== 0 && x.k.checkedAt && x.k.checks.length >= 2);
  const up = winners.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 3);
  const down = winners.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 3);

  return (
    <div className="space-y-6">
      {pending && <RefreshWhile ms={15000} />}
      {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
      {added && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Added {added} keyword{added === "1" ? "" : "s"}. First positions arrive in a minute or two.</p>}
      {queued && <p className="rounded-xl bg-indigo-50 p-3 text-sm text-indigo-800">Checking {queued} keyword{queued === "1" ? "" : "s"} now. This page updates by itself.</p>}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <div className="text-xs text-slate-500">{s.label}</div>
            <div className="num mt-1 text-2xl font-medium">{s.value}</div>
          </div>
        ))}
      </section>

      {(up.length > 0 || down.length > 0) && (
        <section className="grid gap-3 md:grid-cols-2">
          <div className="card p-4">
            <div className="mb-2 text-xs font-medium text-emerald-600">Climbing</div>
            {up.length ? up.map(({ k, d }) => <div key={k.id} className="flex justify-between gap-3 py-1 text-sm"><span className="truncate">{k.keyword}</span><span className="num shrink-0 text-emerald-600">▲ {d} → {k.position ?? "30+"}</span></div>) : <p className="text-sm text-slate-400">Nothing yet.</p>}
          </div>
          <div className="card p-4">
            <div className="mb-2 text-xs font-medium text-red-600">Dropping</div>
            {down.length ? down.map(({ k, d }) => <div key={k.id} className="flex justify-between gap-3 py-1 text-sm"><span className="truncate">{k.keyword}</span><span className="num shrink-0 text-red-600">▼ {-d} → {k.position ?? "30+"}</span></div>) : <p className="text-sm text-slate-400">Nothing dropping. </p>}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Keyword tracking</h2>
            <p className="text-sm text-slate-500">Checked every day, top 30 results, searched from: <b className="font-medium text-slate-700">{loc.label}</b>{pending && <span className="ml-2 text-indigo-600">· checking…</span>}</p>
          </div>
          {editable && ready && kws.length > 0 && <form action={checkRanksNowAction.bind(null, id)}><SubmitButton className="btn-secondary">Check now</SubmitButton></form>}
        </div>
        <DataTable
          id="rankings"
          columns={[
            { key: "keyword", label: "Keyword", className: "min-w-44" },
            { key: "google", label: "Google", type: "number", title: "Organic position (empty = not in the top 30)" },
            { key: "change", label: "Change", type: "number", title: "Places gained since the last check" },
            { key: "map", label: "Map pack", type: "number" },
            { key: "best", label: "Best", type: "number" },
            { key: "trend", label: "30 days", sortable: false, filterable: false },
            { key: "url", label: "Ranking page" },
            { key: "checked", label: "Checked", type: "date", hidden: true },
            ...(editable ? [{ key: "remove", label: "", sortable: false, filterable: false } as Col] : []),
          ]}
          rows={kws.map((k) => ({
            id: k.id,
            values: {
              keyword: k.keyword, google: k.position, change: k.checkedAt && k.checks.length >= 2 ? (k.prevPosition ?? 31) - (k.position ?? 31) : null,
              map: k.mapPosition, best: k.bestPosition, url: k.url?.replace(/^https?:\/\/[^/]+/, "") || "", checked: k.checkedAt?.toISOString() ?? null,
            },
            cells: {
              keyword: <div className="font-medium">{k.keyword}{k.error && <span className="block text-xs font-normal text-red-600">{k.error}</span>}</div>,
              google: k.checkedAt || k.position != null ? <Pos v={k.position} /> : <span className="text-xs text-slate-400">{k.pendingTask ? "checking…" : "—"}</span>,
              change: <Move now={k.position} prev={k.prevPosition} first={k.checks.length < 2} />,
              map: k.mapPosition != null ? <span className="num rounded-lg bg-amber-50 px-2 py-0.5 text-sm font-medium text-amber-700">#{k.mapPosition}</span> : <span className="text-xs text-slate-400">{k.checkedAt ? "not in pack" : "—"}</span>,
              trend: <RankSparkline points={k.checks.filter((c) => c.position != null).map((c) => ({ position: c.position! }))} width={110} height={28} />,
              url: <div className="max-w-[16rem] truncate text-xs">{k.url ? <a href={k.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{k.url.replace(/^https?:\/\/[^/]+/, "") || "/"}</a> : <span className="text-slate-400">—</span>}</div>,
              remove: <form action={removeRankKeywordAction.bind(null, id, k.id)}><SubmitButton className="text-xs text-slate-400 hover:text-red-600">Remove</SubmitButton></form>,
            },
          }))}
          presets={[
            { label: "Top 3", filters: { google: "<=3" } },
            { label: "Top 10", filters: { google: "<=10" } },
            { label: "Page 2", filters: { google: "11-20" } },
            { label: "In the map pack", filters: { map: ">0" } },
            { label: "Climbing", filters: { change: ">0" } },
            { label: "Dropping", filters: { change: "<0" } },
          ]}
          searchPlaceholder="Search keywords"
          empty="No keywords tracked yet. Add some below."
        />
      </section>

      {editable && (
        <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
          <form action={addRankKeywordsAction.bind(null, id)} className="card space-y-3">
            <h3 className="font-sans text-sm font-semibold tracking-normal">Track keywords</h3>
            <textarea name="keywords" rows={3} className="input" placeholder={"gate repair houston\nautomatic gate installation near me"} />
            {suggestions.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs text-slate-500">Suggestions from approved keywords and published articles:</div>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <label key={s} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs has-[:checked]:border-indigo-300 has-[:checked]:bg-indigo-50 has-[:checked]:text-indigo-700">
                      <input type="checkbox" name="pick" value={s} className="sr-only" />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton className="btn-primary" disabled={!ready}>Add and check</SubmitButton>
              <span className="text-xs text-slate-400">About $0.002 per keyword per day at DataForSEO (≈ $0.06 a month each). Up to 200 per client.</span>
            </div>
          </form>
          <form action={saveRankLocationAction.bind(null, id)} className="card space-y-3">
            <h3 className="font-sans text-sm font-semibold tracking-normal">Search from</h3>
            <input name="location" defaultValue={client.rankLocation ?? ""} className="input" placeholder="Houston,Texas,United States" />
            <p className="text-xs text-slate-500">Leave empty to search from the first Google profile&apos;s pin (best for the map pack), or the target country. Use DataForSEO&apos;s format: City,State,Country.</p>
            <SubmitButton className="btn-secondary">Save</SubmitButton>
            {saved && <span className="ml-2 text-xs text-emerald-700">Saved</span>}
          </form>
        </section>
      )}
    </div>
  );
}
