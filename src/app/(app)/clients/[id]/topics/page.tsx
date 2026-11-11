import { backfillImported } from "@/lib/wp-import";
import { clientArticles, usageIndex } from "@/lib/keyword-usage";
import Link from "next/link";
import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { KeywordLink, StatusBadge } from "@/components/ui";
import { DataTable, type Row } from "@/components/data-table";
import { fmtDate } from "@/lib/utils";
import { editTopicAction, setTopicStatusAction } from "../../../../actions";
import { SubmitButton } from "@/components/submit-button";

export default async function TopicsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; edit?: string }> }) {
  const { id } = await params;
  const { status, edit } = await searchParams;
  const user = await requireUser();
  // Posts imported before keywords/topics were filled in get them now (fast no-op afterwards).
  await backfillImported(id).catch((e) => console.error("backfill imported", e));
  const editable = await canEdit(user, id);
  const topics = await db.topic.findMany({
    where: { clientId: id },
    orderBy: [{ generatedAt: "desc" }],
    include: { article: { select: { id: true, status: true } } },
    take: 2000,
  });
  const usedBy = usageIndex(await clientArticles(id));

  return (
    <div className="space-y-4">
      <form>
        <DataTable
          id="topics"
          columns={[
            { key: "title", label: "Topic" },
            { key: "keyword", label: "Keyword" },
            { key: "reuse", label: "Keyword reuse", type: "enum", hidden: true, title: "Whether another blog already targets this keyword" },
            { key: "category", label: "Category", type: "enum" },
            { key: "status", label: "Status", type: "enum" },
            { key: "article", label: "Article", type: "enum" },
            { key: "generated", label: "Generated", type: "date" },
            { key: "angle", label: "Angle", hidden: true },
          ]}
          rows={topics.map((t): Row => {
            const dup = t.keyword ? usedBy(t.keyword, t.article?.id).filter((b) => b.match === "same") : [];
            return {
            id: t.id,
            href: t.article ? `/articles/${t.article.id}` : undefined,
            selectable: editable && !t.article,
            values: { title: t.title, keyword: t.keyword, reuse: dup.length ? "Already used" : "New", category: t.category ?? "", status: t.status, article: t.article ? t.article.status : "No article", generated: t.generatedAt.toISOString(), angle: t.angle ?? "" },
            cells: {
              title: (
                <div className="min-w-64">
                  {t.article ? (
                    <Link className="font-medium text-indigo-700 decoration-indigo-300 decoration-2 underline-offset-4 hover:underline" href={`/articles/${t.article.id}`}>{t.title}</Link>
                  ) : editable ? (
                    <Link className="font-medium text-slate-900 decoration-indigo-300 decoration-2 underline-offset-4 hover:text-indigo-700 hover:underline" href={`/clients/${id}/topics?edit=${t.id}#edit`} title="Edit this topic">{t.title}</Link>
                  ) : <div className="font-medium">{t.title}</div>}
                  {t.angle && <div className="text-xs text-slate-500">{t.angle}</div>}
                </div>
              ),
              keyword: t.keyword ? (
                <div className="min-w-40">
                  <KeywordLink keyword={t.keyword} />
                  {dup.length > 0 && (
                    <Link href={`/articles/${dup[0].id}`} className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:underline" title={dup.map((d) => d.title).join("\n")}>
                      Already used by {dup.length === 1 ? `"${dup[0].title.slice(0, 40)}${dup[0].title.length > 40 ? "…" : ""}"` : `${dup.length} blogs`}
                    </Link>
                  )}
                </div>
              ) : "",
              status: <StatusBadge status={t.status} />,
              article: t.article ? <Link className="text-indigo-600 hover:underline" href={`/articles/${t.article.id}`}><StatusBadge status={t.article.status} /></Link> : <span className="text-xs text-slate-400">none yet</span>,
              generated: <span className="whitespace-nowrap">{fmtDate(t.generatedAt)}</span>,
            },
          };
          })}
          initialFilters={status ? { status: [status] } : undefined}
          presets={[
            { label: "To review", filters: { status: ["GENERATED"] } },
            { label: "Approved", filters: { status: ["APPROVED"] } },
            { label: "Waiting for an article", filters: { status: ["APPROVED"], article: ["No article"] } },
            { label: "Rejected", filters: { status: ["REJECTED"] } },
            { label: "From WordPress", filters: { category: ["From WordPress"] } },
            { label: "Keyword already used", filters: { reuse: ["Already used"] }, tone: "text-amber-700" },
          ]}
          searchPlaceholder="Search topics and keywords"
          empty="No topics yet. n8n WF1 creates them from approved keywords."
          bulk={editable ? (
            <>
              <SubmitButton data-celebrate="approved" formAction={setTopicStatusAction.bind(null, id, "APPROVED")} className="btn-primary px-3 py-1.5 text-xs">Approve</SubmitButton>
              <SubmitButton formAction={setTopicStatusAction.bind(null, id, "REJECTED")} className="btn-danger px-3 py-1.5 text-xs">Reject</SubmitButton>
            </>
          ) : undefined}
        />
      </form>

      {editable && edit && (() => {
        const t = topics.find((x) => x.id === edit);
        if (!t) return null;
        return (
          <form id="edit" action={editTopicAction.bind(null, t.id)} className="card scroll-mt-24 space-y-3">
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
