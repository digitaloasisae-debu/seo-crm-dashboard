import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { accessLevel } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Field, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { addNoteAction, deleteNoteAction, pushArticleAction, reviewArticleAction, runAiReviewAction, saveArticleAction } from "../../../actions";
import { QualityCard } from "@/components/quality-card";
import { NoteForm } from "./note-form";
import { runQuality, type QualityReport } from "@/lib/quality";
import { geminiConfigured } from "@/lib/gemini";
import { SubmitButton } from "@/components/submit-button";

export const maxDuration = 60; // WordPress push with retries and image upload

export default async function ArticleReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const article = await db.article.findUnique({
    where: { id },
    include: { client: true, topic: true, postingSlot: true, notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } } },
  });
  if (!article) notFound();
  // Articles from before the SOP checker existed get checked on first view.
  if (!article.qualityReport && article.bodyHtml.length > 400) {
    const q = await runQuality(article.id).catch(() => null);
    if (q) { article.qualityScore = q.score; article.qualityReport = q.report as never; article.qualityCheckedAt = new Date(); }
  }
  const level = await accessLevel(user, article.clientId);
  if (!level) notFound();
  const editable = level !== "VIEW";
  const locked = ["PUSHING", "PUSHED_DRAFT"].includes(article.status);
  const hasCred = !!(await db.clientCredential.findUnique({ where: { clientId_kind: { clientId: article.clientId, kind: "WORDPRESS" } } }));
  const approver = article.approvedById ? await db.user.findUnique({ where: { id: article.approvedById }, select: { name: true } }) : null;

  return (
    <>
      <div className="mb-4 text-sm"><Link className="text-indigo-600 hover:underline" href={`/clients/${article.clientId}/articles`}>← {article.client.name}</Link></div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="bg-gradient-to-r from-slate-900 via-indigo-900 to-violet-800 bg-clip-text text-2xl font-bold tracking-tight text-transparent">{article.metaTitle}</h1>
        <StatusBadge status={article.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <article className="card prose-preview lg:col-span-3">
          {article.featuredImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={article.featuredImageUrl} alt="Featured" />
          )}
          <div dangerouslySetInnerHTML={{ __html: article.bodyHtml }} />
        </article>

        <aside className="space-y-6 lg:col-span-2">
          <section className="card space-y-2 text-sm">
            <div><span className="text-slate-500">Topic:</span> {article.topic.title}</div>
            {article.topic.angle && <div><span className="text-slate-500">Angle:</span> {article.topic.angle}</div>}
            <div><span className="text-slate-500">Scheduled:</span> {fmtDate(article.postingSlot?.scheduledDate) || "next open slot at push time"}</div>
            {approver && <div><span className="text-slate-500">Approved by:</span> {approver.name} on {fmtDate(article.approvedAt)}</div>}
            {article.wpPostUrl && <div><a className="text-indigo-600 hover:underline" href={article.wpPostUrl} target="_blank" rel="noreferrer">Open WordPress draft #{article.wpPostId}</a></div>}
            {article.lastPushError && article.status === "PUSH_FAILED" && <div className="rounded bg-red-50 p-2 text-red-700">Push failed: {article.lastPushError}</div>}
          </section>

          {editable && !locked && (
            <section className="card space-y-3">
              <h2 className="font-semibold">Review</h2>
              {article.status !== "APPROVED" && article.status !== "PUSH_FAILED" && (
                <form action={reviewArticleAction.bind(null, id, "APPROVED")}>
                  <SubmitButton data-celebrate="approved" className="btn-primary w-full">Approve</SubmitButton>
                </form>
              )}
              {(article.status === "APPROVED" || article.status === "PUSH_FAILED") && (
                <form action={pushArticleAction.bind(null, id)}>
                  <SubmitButton data-celebrate="pushed" className="btn-primary w-full" disabled={!hasCred}>{article.status === "PUSH_FAILED" ? "Retry push to WordPress" : "Push to WordPress as draft"}</SubmitButton>
                  {!hasCred && <p className="mt-1 text-xs text-red-600">No WordPress access saved for this client.</p>}
                </form>
              )}
            </section>
          )}

          <section className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Notes</h2>
              <span className="text-xs text-slate-400">{article.notes.length} note{article.notes.length === 1 ? "" : "s"}</span>
            </div>
            <NoteForm action={addNoteAction.bind(null, id)} />
            {article.notes.length > 0 && (
              <ul className="stagger space-y-2">
                {article.notes.map((n) => (
                  <li key={n.id} className="group rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">{n.author?.name ?? "Someone"}</span>
                      <span>· {n.kind.toLowerCase()}</span>
                      <span>· {fmtDate(n.createdAt)}</span>
                      {n.learnedAt ? <span className="ml-auto rounded-full bg-violet-50 px-2 py-0.5 text-violet-700" title="The client's brain has learned from this note">🧠 learned</span> : <span className="ml-auto text-slate-400">learning…</span>}
                      {(n.authorId === user.id || user.role !== "MEMBER") && (
                        <form action={deleteNoteAction.bind(null, n.id)}><button className="cursor-pointer text-slate-300 opacity-0 transition group-hover:opacity-100 hover:text-red-600" title="Delete note">✕</button></form>
                      )}
                    </div>
                    {n.quote && <blockquote className="mb-1 border-l-2 border-indigo-200 pl-2 text-xs text-slate-500 italic">{n.quote}</blockquote>}
                    <p className="text-slate-800">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <QualityCard
            score={article.qualityScore}
            report={article.qualityReport as unknown as QualityReport | null}
            checkedAt={article.qualityCheckedAt}
            aiAction={runAiReviewAction.bind(null, id)}
            canRun={editable}
            aiReady={geminiConfigured()}
          />

          {editable && !locked && (
            <form action={saveArticleAction.bind(null, id)} className="card space-y-3">
              <h2 className="font-semibold">Edit before publishing</h2>
              <Field label="Meta title"><input className="input" name="metaTitle" defaultValue={article.metaTitle} required /></Field>
              <Field label="Slug"><input className="input" name="slug" defaultValue={article.slug} /></Field>
              <Field label="Meta description"><textarea className="input" name="metaDescription" rows={3} defaultValue={article.metaDescription ?? ""} /></Field>
              <Field label="Focus keyword"><input className="input" name="focusKeyword" defaultValue={article.focusKeyword} /></Field>
              <Field label="Featured image URL"><input className="input" name="featuredImageUrl" defaultValue={article.featuredImageUrl ?? ""} /></Field>
              <Field label="Body HTML"><textarea className="input font-mono text-xs" name="bodyHtml" rows={14} defaultValue={article.bodyHtml} /></Field>
              <SubmitButton className="btn-secondary">Save changes</SubmitButton>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
