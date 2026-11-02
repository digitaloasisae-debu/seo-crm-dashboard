import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Empty, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { addKeywordsAction, deleteKeywordsAction, setKeywordStatusAction } from "../../../../actions";

export default async function KeywordsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; used?: string }> }) {
  const { id } = await params;
  const { status, used } = await searchParams;
  const user = await requireUser();
  const editable = await canEdit(user, id);
  const keywords = await db.keyword.findMany({
    where: {
      clientId: id,
      ...(status ? { status: status as "APPROVED" } : {}),
      ...(used ? { used: used === "true" } : {}),
    },
    orderBy: [{ used: "asc" }, { addedAt: "desc" }],
    take: 500,
  });

  const filters = [
    { label: "All", q: "" },
    { label: "Approved, unused", q: "?status=APPROVED&used=false" },
    { label: "Pending", q: "?status=PENDING" },
    { label: "Used", q: "?used=true" },
    { label: "Rejected", q: "?status=REJECTED" },
  ];

  return (
    <div className="space-y-6">
      {editable && (
        <form action={addKeywordsAction.bind(null, id)} className="card flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1"><span className="label">Add keywords (comma or one per line)</span><textarea className="input" name="keywords" rows={2} required /></label>
          <label className="w-48"><span className="label">Category (optional)</span><input className="input" name="category" /></label>
          <button className="btn-primary">Add</button>
        </form>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {filters.map((f) => <a key={f.label} href={`/clients/${id}/keywords${f.q}`} className="btn-secondary">{f.label}</a>)}
      </div>

      {keywords.length === 0 ? <Empty>No keywords match.</Empty> : (
        <form className="card overflow-x-auto p-0">
          {editable && (
            <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
              <button formAction={setKeywordStatusAction.bind(null, id, "APPROVED")} className="btn-primary">Approve selected</button>
              <button formAction={setKeywordStatusAction.bind(null, id, "REJECTED")} className="btn-danger">Reject selected</button>
              <button formAction={deleteKeywordsAction.bind(null, id)} className="btn-secondary">Delete selected (unused only)</button>
            </div>
          )}
          <table className="table">
            <thead><tr>{editable && <th></th>}<th>Keyword</th><th>Category</th><th>Volume</th><th>KD</th><th>Status</th><th>Used</th><th>Added</th><th>Source</th></tr></thead>
            <tbody>
              {keywords.map((k) => (
                <tr key={k.id} className={k.used ? "text-slate-400" : ""}>
                  {editable && <td><input type="checkbox" name="ids" value={k.id} /></td>}
                  <td className="font-medium">{k.keyword}</td>
                  <td>{k.category}</td>
                  <td>{k.searchVolume ?? ""}</td>
                  <td>{k.difficulty ?? ""}</td>
                  <td><StatusBadge status={k.status} /></td>
                  <td>{k.used ? fmtDate(k.usedAt) || "yes" : ""}</td>
                  <td>{fmtDate(k.addedAt)}</td>
                  <td className="text-xs">{k.source.toLowerCase()}{k.submittedBy ? ` · ${k.submittedBy}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </form>
      )}
    </div>
  );
}
