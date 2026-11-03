import Link from "next/link";
import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Empty, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { editTopicAction, setTopicStatusAction } from "../../../../actions";
import { SubmitButton } from "@/components/submit-button";

export default async function TopicsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; edit?: string }> }) {
  const { id } = await params;
  const { status, edit } = await searchParams;
  const user = await requireUser();
  const editable = await canEdit(user, id);
  const topics = await db.topic.findMany({
    where: { clientId: id, ...(status ? { status: status as "APPROVED" } : {}) },
    orderBy: [{ generatedAt: "desc" }],
    include: { article: { select: { id: true, status: true } } },
    take: 300,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        {[["All", ""], ["To review", "GENERATED"], ["Approved", "APPROVED"], ["Rejected", "REJECTED"]].map(([l, s]) => (
          <a key={l} href={`/clients/${id}/topics${s ? `?status=${s}` : ""}`} className="btn-secondary">{l}</a>
        ))}
      </div>

      {topics.length === 0 ? <Empty>No topics yet. n8n WF1 creates them from approved keywords.</Empty> : (
        <form className="card overflow-x-auto p-0">
          {editable && (
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
              <SubmitButton formAction={setTopicStatusAction.bind(null, id, "APPROVED")} className="btn-primary">Approve selected</SubmitButton>
              <SubmitButton formAction={setTopicStatusAction.bind(null, id, "REJECTED")} className="btn-danger">Reject selected</SubmitButton>
            </div>
          )}
          <table className="table">
            <thead><tr>{editable && <th></th>}<th>Topic</th><th>Keyword</th><th>Category</th><th>Status</th><th>Article</th><th>Generated</th>{editable && <th></th>}</tr></thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t.id}>
                  {editable && <td>{!t.article && <input type="checkbox" name="ids" value={t.id} />}</td>}
                  <td>
                    <div className="font-medium">{t.title}</div>
                    {t.angle && <div className="text-xs text-slate-500">{t.angle}</div>}
                  </td>
                  <td>{t.keyword}</td>
                  <td>{t.category}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>{t.article ? <Link className="text-indigo-600 hover:underline" href={`/articles/${t.article.id}`}><StatusBadge status={t.article.status} /></Link> : ""}</td>
                  <td>{fmtDate(t.generatedAt)}</td>
                  {editable && <td>{!t.article && <Link className="text-xs text-indigo-600 hover:underline" href={`/clients/${id}/topics?edit=${t.id}`}>Edit</Link>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </form>
      )}

      {editable && edit && (() => {
        const t = topics.find((x) => x.id === edit);
        if (!t) return null;
        return (
          <form action={editTopicAction.bind(null, t.id)} className="card space-y-3">
            <h3 className="font-semibold">Edit topic</h3>
            <label className="block"><span className="label">Title</span><input className="input" name="title" defaultValue={t.title} required /></label>
            <label className="block"><span className="label">Angle</span><textarea className="input" name="angle" rows={2} defaultValue={t.angle ?? ""} /></label>
            <label className="block"><span className="label">Category</span><input className="input" name="category" defaultValue={t.category ?? ""} /></label>
            <p className="text-xs text-slate-500">Saving puts the topic back to &quot;to review&quot;.</p>
            <SubmitButton className="btn-primary">Save</SubmitButton>
          </form>
        );
      })()}
    </div>
  );
}
