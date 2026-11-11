import Link from "next/link";
import { db } from "@/lib/db";
import { Empty, RankChange, StatusBadge } from "@/components/ui";
import { articleRanks, matchArticleSlug } from "@/lib/gsc-report";
import { fmtDate } from "@/lib/utils";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { SubmitButton } from "@/components/submit-button";
import { importWordPressAction } from "./actions";

export const maxDuration = 120;

export default async function ArticlesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ src?: string; imported?: string; synced?: string; partial?: string; importErr?: string }> }) {
  const { id } = await params;
  const { src, imported, synced, partial, importErr } = await searchParams;
  const user = await requireUser();
  const [editable, hasWp, nImported, nOwn] = await Promise.all([
    canEdit(user, id),
    db.clientCredential.findUnique({ where: { clientId_kind: { clientId: id, kind: "WORDPRESS" } }, select: { id: true } }).then(Boolean),
    db.article.count({ where: { clientId: id, importedAt: { not: null } } }),
    db.article.count({ where: { clientId: id, importedAt: null } }),
  ]);
  const articles = await db.article.findMany({
    where: { clientId: id, ...(src === "imported" ? { importedAt: { not: null } } : src === "rankflow" ? { importedAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    include: { postingSlot: true },
    take: 300,
  });
  const [ranks, client] = await Promise.all([articleRanks(id), db.client.findUniqueOrThrow({ where: { id }, select: { gscProperty: true, gscSyncedAt: true } })]);
  const hasRanks = !!client.gscProperty;
  const rankOf = (a: (typeof articles)[number]) => { const m = matchArticleSlug(a, ranks.keys()); return m ? ranks.get(m) : undefined; };
  const tab = (key: string | undefined, label: string, n: number) => (
    <Link href={`/clients/${id}/articles${key ? `?src=${key}` : ""}`} className={`rounded-full px-3 py-1 ${src === key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label} <span className="num opacity-70">{n}</span></Link>
  );
  return (
    <div className="space-y-3">
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <div className="flex flex-wrap gap-1.5 text-xs font-medium">
        {tab(undefined, "All", nOwn + nImported)}
        {tab("rankflow", "Written in Rankflow", nOwn)}
        {tab("imported", "Imported from WordPress", nImported)}
      </div>
      <span className="flex-1" />
      {editable && (hasWp ? (
        <form action={importWordPressAction.bind(null, id)} className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" name="pages" defaultChecked /> Include pages</label>
          <SubmitButton className="btn-secondary text-sm">↓ {nImported ? "Sync from WordPress" : "Import from WordPress"}</SubmitButton>
        </form>
      ) : <span className="text-xs text-slate-500">Save the WordPress login on the <Link href={`/clients/${id}/settings`} className="text-indigo-600 hover:underline">Settings tab</Link> to import older posts.</span>)}
    </div>
    {importErr && <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{importErr}</p>}
    {imported != null && <p className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Imported {imported} new and refreshed {synced ?? 0} from WordPress.{partial && " There's more: press Sync again to continue."} The Refresh tab can now rewrite them.</p>}
    {articles.length === 0 && <Empty>{src === "imported" ? "Nothing imported yet. Press Import from WordPress above." : "No articles yet. n8n WF2 writes them from approved topics."}</Empty>}
    {!client.gscProperty && <p className="rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-600">Google rankings appear here once this client is linked to Search Console on the <Link className="text-indigo-600 hover:underline" href="/google">Google</Link> page.</p>}
    {client.gscProperty && ranks.size === 0 && <p className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800">No ranking history yet. Open the <Link className="font-medium underline" href={`/clients/${id}/seo`}>SEO tab</Link> and click <b>Refresh now</b> once to load it.</p>}
    {articles.length > 0 && <div className="card overflow-x-auto p-0">
      <table className="table">
        <thead><tr><th>Title</th><th title="SOP check score">SOP</th><th title="Content score vs Google top 10">Top 10</th>{hasRanks && <th title="Average Google position of the post, last 4 weeks (Search Console)">Google</th>}<th>Focus keyword</th><th>Status</th><th>Scheduled</th><th>WordPress</th><th>Created</th></tr></thead>
        <tbody>
          {articles.map((a) => (
            <tr key={a.id}>
              <td><Link className="font-medium text-indigo-600 hover:underline" href={`/articles/${a.id}`}>{a.metaTitle}</Link>{a.importedAt && <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 uppercase">{a.wpType === "page" ? "page" : "post"}{a.wpBuilder && " · builder"}</span>}</td>
              <td>{a.qualityScore != null ? <span className={`inline-flex min-w-9 justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${a.qualityScore >= 85 ? "bg-emerald-50 text-emerald-700" : a.qualityScore >= 65 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{a.qualityScore}</span> : <span className="text-slate-300">—</span>}</td>
              <td>{a.contentScore != null ? <span className={`inline-flex min-w-9 justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${a.contentScore >= 75 ? "bg-emerald-50 text-emerald-700" : a.contentScore >= 55 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{a.contentScore}</span> : <span className="text-slate-300">—</span>}</td>
              {hasRanks && (
                <td className="whitespace-nowrap">
                  {(() => { const r = rankOf(a); return r ? <>#{r.position.toFixed(1)} <RankChange position={r.position} prev={r.prevPosition} /></> : <span className="text-slate-300" title="Not found in Google results for the last 4 weeks">—</span>; })()}
                </td>
              )}
              <td>{a.focusKeyword}</td>
              <td>{a.importedAt && a.status === "PUSHED_DRAFT" ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">live</span> : <StatusBadge status={a.status} />}</td>
              <td>{fmtDate(a.postingSlot?.scheduledDate)}</td>
              <td>{a.wpPostUrl ? <a className="text-indigo-600 hover:underline" href={a.wpPostUrl} target="_blank" rel="noreferrer">{a.importedAt ? "view" : "draft"} #{a.wpPostId}</a> : ""}</td>
              <td>{fmtDate(a.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>}
    </div>
  );
}
