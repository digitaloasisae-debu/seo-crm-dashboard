import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { accessLevel } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Field, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { pushArticleAction, reviewArticleAction, saveArticleAction } from "../../../actions";

export const maxDuration = 60; // WordPress push with retries and image upload

export default async function ArticleReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const article = await db.article.findUnique({
    where: { id },
    include: { client: true, topic: true, postingSlot: true },
  });
  if (!article) notFound();
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
        <h1 className="text-2xl font-semibold">{article.metaTitle}</h1>
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
                  <button className="btn-primary w-full">Approve</button>
                </form>
              )}
              {(article.status === "APPROVED" || article.status === "PUSH_FAILED") && (
                <form action={pushArticleAction.bind(null, id)}>
                  <button className="btn-primary w-full" disabled={!hasCred}>{article.status === "PUSH_FAILED" ? "Retry push to WordPress" : "Push to WordPress as draft"}</button>
                  {!hasCred && <p className="mt-1 text-xs text-red-600">No WordPress access saved for this client.</p>}
                </form>
              )}
            </section>
          )}

          {editable && !locked && (
            <form action={saveArticleAction.bind(null, id)} className="card space-y-3">
              <h2 className="font-semibold">Edit before publishing</h2>
              <Field label="Meta title"><input className="input" name="metaTitle" defaultValue={article.metaTitle} required /></Field>
              <Field label="Slug"><input className="input" name="slug" defaultValue={article.slug} /></Field>
              <Field label="Meta description"><textarea className="input" name="metaDescription" rows={3} defaultValue={article.metaDescription ?? ""} /></Field>
              <Field label="Focus keyword"><input className="input" name="focusKeyword" defaultValue={article.focusKeyword} /></Field>
              <Field label="Featured image URL"><input className="input" name="featuredImageUrl" defaultValue={article.featuredImageUrl ?? ""} /></Field>
              <Field label="Body HTML"><textarea className="input font-mono text-xs" name="bodyHtml" rows={14} defaultValue={article.bodyHtml} /></Field>
              <button className="btn-secondary">Save changes</button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
