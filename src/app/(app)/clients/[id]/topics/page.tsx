import { backfillImported } from "@/lib/wp-import";
import { clientArticles, usageIndex } from "@/lib/keyword-usage";
import Link from "next/link";
import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { KeywordLink, StatusBadge } from "@/components/ui";
import { DataTable, type Row } from "@/components/data-table";
import { fmtDate } from "@/lib/utils";
import { briefTopicsAction, deleteTopicsAction, editTopicAction, setTopicStatusAction } from "../../../../actions";
import { after } from "next/server";
import { BRIEF_STALE_MS, briefTopics, type OutlineItem } from "@/lib/topic-brief";
import { geminiConfigured } from "@/lib/gemini";
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
  const briefing = (t: { briefingAt: Date | null }) => !!t.briefingAt && Date.now() - t.briefingAt.getTime() < BRIEF_STALE_MS;
  // New topics get a researched brief when n8n saves them; if that didn't finish, pick up to 3 here.
  const todo = editable && geminiConfigured() ? topics.filter((t) => t.status === "GENERATED" && !t.article && !t.briefAt && !t.briefError && !briefing(t) && t.generatedAt > new Date("2026-11-16T00:00:00Z")).slice(0, 3) : [];
  if (todo.length) {
    await db.topic.updateMany({ where: { id: { in: todo.map((t) => t.id) } }, data: { briefingAt: new Date() } });
    for (const t of todo) t.briefingAt = new Date();
    after(() => briefTopics(todo.map((t) => t.id)));
  }

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
            selectable: (editable && !t.article) || user.role === "SUPER_ADMIN",
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
                  {briefing(t) && <div className="mt-1 text-xs font-medium text-indigo-600">Researching the brief on Google… refresh in a minute</div>}
                  {t.briefError && !briefing(t) && <div className="mt-1 text-xs text-rose-600">Brief failed: {t.briefError}</div>}
                  {t.briefAt && !briefing(t) && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer font-medium text-indigo-700">Brief: SEO title, outline{Array.isArray(t.briefSources) && (t.briefSources as unknown[]).length ? ", sources" : ""}</summary>
                      <div className="mt-1.5 space-y-1.5 rounded-lg bg-slate-50 p-2.5 text-slate-700">
                        {t.seoTitle && <div><span className="text-slate-500">SEO title ({t.seoTitle.length}):</span> {t.seoTitle}</div>}
                        {t.metaDescription && <div><span className="text-slate-500">Meta ({t.metaDescription.length}):</span> {t.metaDescription}</div>}
                        {((t.outline as OutlineItem[] | null) ?? []).length > 0 && (
                          <ol className="list-decimal space-y-0.5 pl-4">{(t.outline as OutlineItem[]).map((o, i) => <li key={i}><b className="font-medium">{o.heading}</b>{o.notes && <span className="text-slate-500"> — {o.notes}</span>}</li>)}</ol>
                        )}
                        {Array.isArray(t.briefSources) && (t.briefSources as { url: string; title: string }[]).length > 0 && (
                          <div className="text-slate-500">Checked on Google: {(t.briefSources as { url: string; title: string }[]).slice(0, 6).map((x, i) => <span key={x.url}>{i > 0 && " · "}<a href={x.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{x.title.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</a></span>)}</div>
                        )}
                      </div>
                    </details>
                  )}
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
              <SubmitButton formAction={briefTopicsAction.bind(null, id)} className="btn-secondary px-3 py-1.5 text-xs" title="Search Google and rewrite the title, angle and outline">Research brief</SubmitButton>
              {user.role === "SUPER_ADMIN" && <SubmitButton formAction={deleteTopicsAction.bind(null, id)} className="btn-danger px-3 py-1.5 text-xs" title="Removes the topic. A written article stays.">Delete</SubmitButton>}
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
            <input type="hidden" name="topicId" value={t.id} />
            <label className="block"><span className="label">Title</span><input className="input" name="title" defaultValue={t.title} required /></label>
            <label className="block"><span className="label">Angle</span><textarea className="input" name="angle" rows={2} defaultValue={t.angle ?? ""} /></label>
            <label className="block"><span className="label">SEO title</span><input className="input" name="seoTitle" defaultValue={t.seoTitle ?? ""} maxLength={80} /></label>
            <label className="block"><span className="label">Meta description</span><textarea className="input" name="metaDescription" rows={2} defaultValue={t.metaDescription ?? ""} /></label>
            <label className="block"><span className="label">Outline (one H2 per line, &quot;Heading — notes&quot;)</span><textarea className="input font-mono text-xs" name="outline" rows={8} defaultValue={((t.outline as OutlineItem[] | null) ?? []).map((o) => (o.notes ? `${o.heading} — ${o.notes}` : o.heading)).join("\n")} /></label>
            <label className="block"><span className="label">Category</span><input className="input" name="category" defaultValue={t.category ?? ""} /></label>
            <p className="text-xs text-slate-500">Saving puts the topic back to &quot;to review&quot;.</p>
            <div className="flex flex-wrap gap-2">
              <SubmitButton className="btn-primary">Save</SubmitButton>
              {!t.article && <SubmitButton formAction={briefTopicsAction.bind(null, id)} formNoValidate className="btn-secondary">Research brief again</SubmitButton>}
            </div>
          </form>
        );
      })()}
    </div>
  );
}
