import Link from "next/link";
import { db } from "@/lib/db";
import { Empty, RankChange, StatusBadge } from "@/components/ui";
import { articleRanks } from "@/lib/gsc-report";
import { fmtDate } from "@/lib/utils";

export default async function ArticlesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const articles = await db.article.findMany({
    where: { clientId: id },
    orderBy: { createdAt: "desc" },
    include: { postingSlot: true },
    take: 300,
  });
  const ranks = await articleRanks(id);
  const hasRanks = ranks.size > 0;
  if (articles.length === 0) return <Empty>No articles yet. n8n WF2 writes them from approved topics.</Empty>;
  return (
    <div className="card overflow-x-auto p-0">
      <table className="table">
        <thead><tr><th>Title</th><th title="SOP check score">SOP</th>{hasRanks && <th title="Average Google position of the post, last 4 weeks (Search Console)">Google</th>}<th>Focus keyword</th><th>Status</th><th>Scheduled</th><th>WordPress</th><th>Created</th></tr></thead>
        <tbody>
          {articles.map((a) => (
            <tr key={a.id}>
              <td><Link className="font-medium text-indigo-600 hover:underline" href={`/articles/${a.id}`}>{a.metaTitle}</Link></td>
              <td>{a.qualityScore != null ? <span className={`inline-flex min-w-9 justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${a.qualityScore >= 85 ? "bg-emerald-50 text-emerald-700" : a.qualityScore >= 65 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{a.qualityScore}</span> : <span className="text-slate-300">—</span>}</td>
              {hasRanks && (
                <td className="whitespace-nowrap">
                  {ranks.get(a.slug.toLowerCase()) ? <>#{ranks.get(a.slug.toLowerCase())!.position.toFixed(1)} <RankChange position={ranks.get(a.slug.toLowerCase())!.position} prev={ranks.get(a.slug.toLowerCase())!.prevPosition} /></> : <span className="text-slate-300">—</span>}
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
  );
}
