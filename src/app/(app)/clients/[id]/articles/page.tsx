import Link from "next/link";
import { db } from "@/lib/db";
import { Empty, RankChange, StatusBadge } from "@/components/ui";
import { articleRanks, matchArticleSlug } from "@/lib/gsc-report";
import { fmtDate } from "@/lib/utils";

export default async function ArticlesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const articles = await db.article.findMany({
    where: { clientId: id },
    orderBy: { createdAt: "desc" },
    include: { postingSlot: true },
    take: 300,
  });
  const [ranks, client] = await Promise.all([articleRanks(id), db.client.findUniqueOrThrow({ where: { id }, select: { gscProperty: true, gscSyncedAt: true } })]);
  const hasRanks = !!client.gscProperty;
  const rankOf = (a: (typeof articles)[number]) => { const m = matchArticleSlug(a, ranks.keys()); return m ? ranks.get(m) : undefined; };
  if (articles.length === 0) return <Empty>No articles yet. n8n WF2 writes them from approved topics.</Empty>;
  return (
    <div className="space-y-3">
    {!client.gscProperty && <p className="rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-600">Google rankings appear here once this client is linked to Search Console on the <Link className="text-indigo-600 hover:underline" href="/google">Google</Link> page.</p>}
    {client.gscProperty && ranks.size === 0 && <p className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800">No ranking history yet. Open the <Link className="font-medium underline" href={`/clients/${id}/seo`}>SEO tab</Link> and click <b>Refresh now</b> once to load it.</p>}
    <div className="card overflow-x-auto p-0">
      <table className="table">
        <thead><tr><th>Title</th><th title="SOP check score">SOP</th><th title="Content score vs Google top 10">Top 10</th>{hasRanks && <th title="Average Google position of the post, last 4 weeks (Search Console)">Google</th>}<th>Focus keyword</th><th>Status</th><th>Scheduled</th><th>WordPress</th><th>Created</th></tr></thead>
        <tbody>
          {articles.map((a) => (
            <tr key={a.id}>
              <td><Link className="font-medium text-indigo-600 hover:underline" href={`/articles/${a.id}`}>{a.metaTitle}</Link></td>
              <td>{a.qualityScore != null ? <span className={`inline-flex min-w-9 justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${a.qualityScore >= 85 ? "bg-emerald-50 text-emerald-700" : a.qualityScore >= 65 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{a.qualityScore}</span> : <span className="text-slate-300">—</span>}</td>
              <td>{a.contentScore != null ? <span className={`inline-flex min-w-9 justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${a.contentScore >= 75 ? "bg-emerald-50 text-emerald-700" : a.contentScore >= 55 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{a.contentScore}</span> : <span className="text-slate-300">—</span>}</td>
              {hasRanks && (
                <td className="whitespace-nowrap">
                  {(() => { const r = rankOf(a); return r ? <>#{r.position.toFixed(1)} <RankChange position={r.position} prev={r.prevPosition} /></> : <span className="text-slate-300" title="Not found in Google results for the last 4 weeks">—</span>; })()}
                </td>
              )}
              <td>{a.focusKeyword}</td>
              <td><StatusBadge status={a.status} /></td>
              <td>{fmtDate(a.postingSlot?.scheduledDate)}</td>
              <td>{a.wpPostUrl ? <a className="text-indigo-600 hover:underline" href={a.wpPostUrl} target="_blank" rel="noreferrer">draft #{a.wpPostId}</a> : ""}</td>
              <td>{fmtDate(a.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}
