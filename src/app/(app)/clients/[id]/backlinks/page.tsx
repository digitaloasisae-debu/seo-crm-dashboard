import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { DataTable } from "@/components/data-table";
import { SubmitButton } from "@/components/submit-button";
import { fmtDate } from "@/lib/utils";
import { dataforseoConfigured } from "@/lib/dataforseo";
import { crawlTarget } from "@/lib/crawl";
import { competitorDomains, type BlSummary, type BlMonth, type BlDomain, type BlLinks, type BlLink, type BlAnchor, type BlCompetitor, type BlGap } from "@/lib/backlinks";
import { refreshBacklinksAction, saveCompetitorsAction } from "./actions";

export const maxDuration = 60;

const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US"));
const short = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : fmt(v));

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "bad" ? "text-red-600" : tone === "good" ? "text-emerald-600" : "text-slate-900"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function Trend({ months }: { months: BlMonth[] }) {
  if (months.length < 2) return null;
  const max = Math.max(1, ...months.map((m) => m.referringDomains));
  const first = months[0].referringDomains, last = months[months.length - 1].referringDomains;
  const diff = last - first;
  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="font-semibold">Referring domains, last 12 months</h2>
        <span className={`text-sm font-semibold ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-slate-500"}`}>{diff > 0 ? "+" : ""}{fmt(diff)}</span>
      </div>
      <div className="flex h-36 items-end gap-1.5">
        {months.map((m) => (
          <div key={m.date} className="group relative flex h-full flex-1 flex-col justify-end" title={`${m.date}: ${fmt(m.referringDomains)} domains, +${m.newDomains} new, −${m.lostDomains} lost`}>
            <div className="rounded-t bg-indigo-500 transition-colors hover:bg-indigo-700" style={{ height: `${Math.max(2, (m.referringDomains / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 text-[10px] text-slate-400">
        {months.map((m) => <div key={m.date} className="flex-1 text-center">{m.date.slice(5)}</div>)}
      </div>
      <div className="mt-3 flex gap-1.5 text-[10px]">
        {months.map((m) => (
          <div key={m.date} className="flex-1 text-center leading-tight">
            <div className="text-emerald-600">+{m.newDomains}</div>
            <div className="text-red-500">−{m.lostDomains}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LinkTable({ id, links, empty, showDates }: { id: string; links: BlLink[]; empty: string; showDates: "first" | "last" }) {
  if (!links.length) return <p className="p-4 text-sm text-slate-500">{empty}</p>;
  return (
    <DataTable
      id={id}
      bare
      pageSize={25}
      columns={[
        { key: "from", label: "From" },
        { key: "anchor", label: "Anchor" },
        { key: "rank", label: "Rank", type: "number" },
        { key: "type", label: "Type", type: "enum" },
        { key: "date", label: showDates === "first" ? "Found" : "Lost", type: "date" },
        { key: "to", label: "Links to", hidden: true },
      ]}
      rows={links.map((l, i) => ({
        id: `${l.from}-${i}`,
        values: { from: `${l.domain} ${l.from}`, anchor: l.anchor || "", rank: l.rank, type: l.dofollow ? "dofollow" : "nofollow", date: showDates === "first" ? l.firstSeen : l.lastSeen, to: l.to },
        cells: {
          from: (
            <div className="max-w-[22rem]">
              <a href={l.from} target="_blank" rel="noreferrer" className="block truncate font-medium text-indigo-600 hover:underline">{l.domain || l.from}</a>
              <div className="truncate text-xs text-slate-400">{l.title || l.from} → {l.to.replace(/^https?:\/\/(www\.)?/, "")}</div>
            </div>
          ),
          anchor: <div className="max-w-[12rem] truncate text-sm">{l.anchor || <span className="text-slate-400">{l.type === "image" ? "(image)" : "—"}</span>}</div>,
          type: <span className={`rounded-md px-2 py-0.5 text-xs ring-1 ring-inset ${l.dofollow ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-500 ring-slate-200"}`}>{l.dofollow ? "dofollow" : "nofollow"}</span>,
          date: <span className="text-xs text-slate-500">{showDates === "first" ? l.firstSeen : l.lastSeen}</span>,
        },
      }))}
      presets={[{ label: "Dofollow", filters: { type: ["dofollow"] } }, { label: "Rank 30+", filters: { rank: ">=30" } }]}
      searchPlaceholder="Search sites and anchors"
    />
  );
}

export default async function BacklinksPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; saved?: string }> }) {
  const { id } = await params;
  const { err, saved } = await searchParams;
  const user = await requireUser();
  const [editable, client, reports] = await Promise.all([
    canEdit(user, id),
    db.client.findUniqueOrThrow({ where: { id }, select: { siteUrl: true, competitors: true } }),
    db.backlinkReport.findMany({ where: { clientId: id }, orderBy: { createdAt: "desc" }, take: 12 }),
  ]);
  const r = reports[0] ?? null;
  const prev = reports[1] ?? null;
  const ready = dataforseoConfigured();
  const target = crawlTarget(client.siteUrl);
  const comps = competitorDomains(client.competitors, target);

  const sum = r?.summary as unknown as BlSummary | undefined;
  const prevSum = prev?.summary as unknown as BlSummary | undefined;
  const history = (r?.history as unknown as BlMonth[] | null) ?? [];
  const domains = (r?.domains as unknown as BlDomain[] | null) ?? [];
  const links = (r?.links as unknown as BlLinks | null) ?? { best: [], recent: [], lost: [] };
  const anchors = (r?.anchors as unknown as BlAnchor[] | null) ?? [];
  const competitors = r?.competitors as unknown as BlCompetitor[] | null;
  const gap = r?.gap as unknown as BlGap[] | null;
  const delta = (k: keyof BlSummary) => (sum && prevSum ? Number(sum[k]) - Number(prevSum[k]) : null);
  const dl = (k: keyof BlSummary) => { const d = delta(k); return d ? `${d > 0 ? "+" : ""}${fmt(d)} vs last check` : undefined; };
  const dofollowPct = sum && sum.backlinks ? Math.round(((sum.backlinks - sum.nofollow) / sum.backlinks) * 100) : 0;

  return (
    <div className="space-y-6">
      <section className="card flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Backlinks for {target}</h2>
          <p className="text-sm text-slate-500">Who links to the site, how strong those links are, what was gained or lost, and how it compares with competitors.{r && <> Last updated {fmtDate(r.createdAt)}.</>}</p>
          {err && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">Couldn&apos;t refresh: {err}</p>}
          {!ready && <p className="mt-2 text-xs text-slate-500">Needs the DataForSEO login in Vercel.</p>}
        </div>
        {editable && ready && (
          <form action={refreshBacklinksAction.bind(null, id)}><SubmitButton className="btn-primary">{r ? "Refresh backlinks" : "Get backlink data"}</SubmitButton></form>
        )}
      </section>

      {sum && (
        <>
          <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Domain rank (0–100)" value={String(sum.rank)} hint={dl("rank")} />
            <Tile label="Referring domains" value={short(sum.referringDomains)} hint={dl("referringDomains") ?? `${fmt(sum.referringIps)} IPs`} />
            <Tile label="Backlinks" value={short(sum.backlinks)} hint={dl("backlinks")} />
            <Tile label="Dofollow" value={`${dofollowPct}%`} hint={`${short(sum.nofollow)} nofollow`} />
            <Tile label="Spam score" value={`${sum.spamScore}%`} tone={sum.spamScore >= 30 ? "bad" : sum.spamScore <= 10 ? "good" : undefined} hint={sum.spamScore >= 30 ? "High: check for toxic links" : "Lower is better"} />
            <Tile label="Broken backlinks" value={fmt(sum.brokenBacklinks)} tone={sum.brokenBacklinks ? "bad" : undefined} hint={sum.brokenPages ? `to ${fmt(sum.brokenPages)} dead pages: redirect them` : "Links to pages that 404"} />
          </section>

          <Trend months={history} />

          {competitors && competitors.length > 1 && (
            <section className="card">
              <h2 className="mb-3 font-semibold">You vs competitors</h2>
              {(() => {
                const maxRd = Math.max(1, ...competitors.map((c) => c.referringDomains));
                return (
                  <div className="space-y-2.5">
                    {[...competitors].sort((a, b) => b.referringDomains - a.referringDomains).map((c) => (
                      <div key={c.target} className="grid grid-cols-[minmax(0,15rem)_1fr_auto] items-center gap-3 text-sm">
                        <span className={`truncate ${c.you ? "font-semibold text-indigo-700" : ""}`}>{c.you ? `${c.target} (you)` : c.target}</span>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${c.you ? "bg-indigo-500" : "bg-slate-400"}`} style={{ width: `${Math.max(2, (c.referringDomains / maxRd) * 100)}%` }} /></div>
                        <span className="w-56 text-right text-xs text-slate-500">{short(c.referringDomains)} domains · {short(c.backlinks)} links · rank {c.rank}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </section>
          )}

          {gap && (
            <section className="card p-0">
              <div className="p-4 pb-2">
                <h2 className="font-semibold">Link gap: sites linking to competitors but not to you ({gap.length})</h2>
                <p className="text-xs text-slate-500">Your best outreach list. Sites that link to several competitors are the easiest wins.</p>
              </div>
              {gap.length === 0 ? <p className="p-4 pt-0 text-sm text-slate-500">No gap found.</p> : (
                <DataTable
                  id="backlinks-gap"
                  bare
                  pageSize={30}
                  columns={[{ key: "site", label: "Site" }, { key: "rank", label: "Rank", type: "number" }, { key: "count", label: "Competitors", type: "number" }, { key: "to", label: "Links to" }]}
                  rows={gap.map((g) => ({
                    id: g.domain,
                    values: { site: g.domain, rank: g.rank, count: g.linksTo.length, to: g.linksTo.join(", ") },
                    cells: {
                      site: <a href={`https://${g.domain}`} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline">{g.domain}</a>,
                      count: g.linksTo.length > 1 ? <span className="num rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 ring-inset">{g.linksTo.length}</span> : <span className="num">1</span>,
                      to: <span className="text-xs text-slate-600">{g.linksTo.join(", ")}</span>,
                    },
                  }))}
                  presets={[{ label: "Links to 2+ competitors", filters: { count: ">=2" } }]}
                  defaultSort={{ key: "count", dir: "desc" }}
                  searchPlaceholder="Search sites"
                />
              )}
            </section>
          )}

          <section className="card p-0">
            <details open>
              <summary className="p-4 font-semibold">🆕 Newest links ({links.recent.length})</summary>
              <LinkTable id="backlinks-new" links={links.recent} empty="No new links found." showDates="first" />
            </details>
            <details className="border-t border-slate-100">
              <summary className="p-4 font-semibold">Lost links ({links.lost.length})</summary>
              <p className="px-4 pb-2 text-xs text-slate-500">Worth checking: a lost link from a strong site can often be won back by emailing the site owner.</p>
              <LinkTable id="backlinks-lost" links={links.lost} empty="No lost links found." showDates="last" />
            </details>
            <details className="border-t border-slate-100">
              <summary className="p-4 font-semibold">Strongest links, one per site ({links.best.length})</summary>
              <LinkTable id="backlinks-best" links={links.best} empty="No links found." showDates="first" />
            </details>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="card p-0">
              <h2 className="p-4 pb-2 font-semibold">Top referring domains</h2>
              {domains.length === 0 ? <p className="p-4 pt-0 text-sm text-slate-500">None found.</p> : (
                <DataTable
                  id="backlinks-domains"
                  bare
                  pageSize={25}
                  columns={[{ key: "domain", label: "Domain" }, { key: "rank", label: "Rank", type: "number" }, { key: "links", label: "Links", type: "number" }, { key: "spam", label: "Spam %", type: "number", hidden: true }, { key: "since", label: "Since", type: "date" }]}
                  rows={domains.map((d) => ({
                    id: d.domain,
                    values: { domain: d.domain, rank: d.rank, links: d.backlinks, spam: d.spam, since: d.firstSeen },
                    cells: {
                      domain: <><a href={`https://${d.domain}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{d.domain}</a>{d.spam >= 50 && <span className="ml-1.5 rounded bg-red-50 px-1 text-[10px] font-semibold text-red-700">spam {d.spam}%</span>}</>,
                      since: <span className="whitespace-nowrap text-xs text-slate-500">{d.firstSeen}</span>,
                    },
                  }))}
                  searchPlaceholder="Search domains"
                />
              )}
            </div>
            <div className="card p-0">
              <h2 className="p-4 pb-2 font-semibold">Anchor text</h2>
              {anchors.length === 0 ? <p className="p-4 pt-0 text-sm text-slate-500">None found.</p> : (
                <DataTable
                  id="backlinks-anchors"
                  bare
                  pageSize={25}
                  columns={[{ key: "anchor", label: "Anchor" }, { key: "domains", label: "Domains", type: "number" }, { key: "links", label: "Links", type: "number" }]}
                  rows={anchors.map((a, i) => ({
                    id: String(i),
                    values: { anchor: a.anchor || "", domains: a.domains, links: a.backlinks },
                    cells: { anchor: <div className="max-w-[16rem] truncate">{a.anchor || <span className="text-slate-400">(empty / image)</span>}</div> },
                  }))}
                  searchPlaceholder="Search anchors"
                />
              )}
            </div>
          </section>
        </>
      )}

      <section className="card">
        <h2 className="font-semibold">Competitor websites</h2>
        <p className="text-sm text-slate-500">Used for the comparison and the link gap (up to 5).{comps.length === 0 && " Add at least one website to see them."}</p>
        {saved && <p className="mt-2 text-sm text-emerald-700">Saved. Refresh backlinks to compare.</p>}
        {editable ? (
          <form action={saveCompetitorsAction.bind(null, id)} className="mt-3 space-y-2">
            <textarea name="competitors" rows={4} className="input font-mono text-xs" defaultValue={client.competitors.join("\n")} placeholder={"competitor1.com\ncompetitor2.com"} />
            <SubmitButton className="btn-secondary">Save competitors</SubmitButton>
          </form>
        ) : <p className="mt-2 text-sm">{comps.join(", ") || "—"}</p>}
      </section>

      {reports.length > 1 && (
        <section className="card p-0">
          <h2 className="p-4 pb-2 font-semibold">History</h2>
          <table className="table">
            <thead><tr><th>Date</th><th>Rank</th><th>Referring domains</th><th>Backlinks</th></tr></thead>
            <tbody>{reports.map((x) => { const sx = x.summary as unknown as BlSummary; return <tr key={x.id}><td>{fmtDate(x.createdAt)}</td><td>{sx.rank}</td><td>{fmt(sx.referringDomains)}</td><td>{fmt(sx.backlinks)}</td></tr>; })}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
