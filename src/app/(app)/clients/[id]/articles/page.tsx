import Link from "next/link";
import { db } from "@/lib/db";
import { Empty, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export default async function ArticlesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const articles = await db.article.findMany({
    where: { clientId: id },
    orderBy: { createdAt: "desc" },
    include: { postingSlot: true },
    take: 300,
  });
  if (articles.length === 0) return <Empty>No articles yet. n8n WF2 writes them from approved topics.</Empty>;
  return (
    <div className="card overflow-x-auto p-0">
      <table className="table">
        <thead><tr><th>Title</th><th>Focus keyword</th><th>Status</th><th>Scheduled</th><th>WordPress</th><th>Created</th></tr></thead>
        <tbody>
          {articles.map((a) => (
            <tr key={a.id}>
              <td><Link className="font-medium text-indigo-600 hover:underline" href={`/articles/${a.id}`}>{a.metaTitle}</Link></td>
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
