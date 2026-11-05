import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { accessLevel } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Field, RankChange, RankSparkline, StatusBadge } from "@/components/ui";
import { articleHistory } from "@/lib/gsc-report";
import { fmtDate } from "@/lib/utils";
import { addNoteAction, applyTitleAction, contentScoreAction, deleteNoteAction, pushArticleAction, fixSopAction, restoreRevisionAction, reviewArticleAction, rewriteArticleAction, runAiReviewAction, saveArticleAction, titleOptionsAction } from "../../../actions";
import { RefreshWhile, RewriteForm, TitleOptions } from "./rewrite";
import { REVISE_STALE_MS } from "@/lib/revise";
import { QualityCard } from "@/components/quality-card";
import { ContentScoreCard } from "@/components/content-score-card";
import { dataforseoConfigured } from "@/lib/dataforseo";
import type { ContentScore } from "@/lib/serp";
import { NoteForm } from "./note-form";
import { runQuality, type QualityReport } from "@/lib/quality";
import { geminiConfigured } from "@/lib/gemini";
import { SubmitButton } from "@/components/submit-button";
import { Spinner } from "@/components/spinner";

// WordPress push with retries, and AI rewrites that run in the background after the response.
export const maxDuration = 300;

export default async function ArticleReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const article = await db.article.findUnique({
    where: { id },
    include: { client: true, topic: true, postingSlot: true, notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } }, revisions: { orderBy: { createdAt: "desc" }, take: 10 } },
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
  const revising = !!article.revisingAt && Date.now() - article.revisingAt.getTime() < REVISE_STALE_MS;
  const reviseError = article.reviseError || (article.revisingAt && !revising ? "The rewrite took too long and stopped. Try again." : null);
  const pendingNotes = article.notes.filter((n) => !n.appliedAt).length;
  const lastRewrite = article.revisions.find((r) => r.changes.length > 0);
  const history = article.client.gscProperty && article.status === "PUSHED_DRAFT" ? await articleHistory(article.clientId, article) : [];
  const last4 = history.slice(-4), prev4 = history.slice(-8, -4);
  const avg = (pts: typeof history) => { const imp = pts.reduce((s, p) => s + p.impressions, 0); return imp ? pts.reduce((s, p) => s + p.position * p.impressions, 0) / imp : null; };
  const rankNow = avg(last4), rankPrev = avg(prev4);
  const best = history.length ? Math.min(...history.map((p) => p.position)) : null;
  const approver = article.approvedById ? await db.user.findUnique({ where: { id: article.approvedById }, select: { name: true } }) : null;

  return (
    <>
      <div className="mb-4 text-sm"><Link className="text-indigo-600 hover:underline" href={`/clients/${article.clientId}/articles`}>← {article.client.name}</Link></div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="bg-gradient-to-r from-slate-900 via-indigo-900 to-violet-800 bg-clip-text text-2xl font-bold tracking-tight text-transparent">{article.metaTitle}</h1>
        <StatusBadge status={article.status} />
      </div>

      {revising && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-violet-200 bg-gradient-to-r from-indigo-50 to-violet-50 p-4 text-sm text-violet-900">
          <RefreshWhile />
          <Spinner className="h-5 w-5 text-violet-600" />
          <div><span className="font-semibold">✨ AI is working on this article…</span> SOP check and fixes or your rewrite take 1 to 3 minutes. The page updates by itself, so you can keep working elsewhere.</div>
        </div>
      )}

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

          {article.status === "PUSHED_DRAFT" && article.client.gscProperty && (
            <section className="card space-y-3">
              <h2 className="font-semibold">📈 Google ranking</h2>
              {history.length === 0 ? (
                <p className="text-sm text-slate-500">No Search Console data for this post yet. It shows up once the post is published and Google starts showing it (usually 1 to 3 weeks).</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-indigo-50/60 p-2"><div className="text-[11px] text-slate-500">Position (4w)</div><div className="text-xl font-bold tabular-nums">{rankNow != null ? rankNow.toFixed(1) : "—"}</div>{rankNow != null && <RankChange position={rankNow} prev={rankPrev} />}</div>
                    <div className="rounded-xl bg-indigo-50/60 p-2"><div className="text-[11px] text-slate-500">Clicks (4w)</div><div className="text-xl font-bold tabular-nums">{last4.reduce((s, p) => s + p.clicks, 0)}</div></div>
                    <div className="rounded-xl bg-indigo-50/60 p-2"><div className="text-[11px] text-slate-500">Best week</div><div className="text-xl font-bold tabular-nums">{best?.toFixed(1)}</div></div>
                  </div>
                  <div>
                    <RankSparkline points={history} width={320} height={56} />
                    <div className="flex justify-between text-[11px] text-slate-400"><span>{fmtDate(history[0].week)}</span><span>weekly position, higher line = better</span><span>{fmtDate(history.at(-1)!.week)}</span></div>
                  </div>
                </>
              )}
            </section>
          )}

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
                      {n.appliedAt && <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700" title="An AI rewrite has applied this note">✓ applied</span>}
                      {n.learnedAt ? <span className={`${n.appliedAt ? "" : "ml-auto "} rounded-full bg-violet-50 px-2 py-0.5 text-violet-700`} title="The client's brain has learned from this note">🧠 learned</span> : <span className={`${n.appliedAt ? "" : "ml-auto "}text-slate-400`}>learning…</span>}
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
          {editable && !locked && geminiConfigured() && (
            <section className="card space-y-4">
              <div>
                <h2 className="font-semibold">✨ Rewrite with AI</h2>
                <p className="mt-0.5 text-xs text-slate-500">Uses this client&apos;s brain, the SOP and the notes above. The current version is saved, so you can undo.</p>
              </div>
              {revising ? (
                <p className="flex items-center gap-2 text-sm text-violet-700"><Spinner /> Rewriting now…</p>
              ) : (
                <RewriteForm action={rewriteArticleAction.bind(null, id)} pendingNotes={pendingNotes} />
              )}
              {reviseError && !revising && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">Last rewrite failed: {reviseError}</p>}
              {lastRewrite && !revising && (
                <details className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-sm" open={Date.now() - lastRewrite.createdAt.getTime() < 10 * 60_000}>
                  <summary className="font-medium text-emerald-800">✓ What the last rewrite changed</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">{lastRewrite.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </details>
              )}
              <div className="border-t border-slate-100 pt-4">
                <TitleOptions action={titleOptionsAction.bind(null, id)} apply={applyTitleAction.bind(null, id)} />
              </div>
              {article.revisions.length > 0 && (
                <details className="text-sm">
                  <summary className="text-slate-600">🕘 Earlier versions ({article.revisions.length})</summary>
                  <ul className="mt-2 space-y-2">
                    {article.revisions.map((r) => (
                      <li key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 p-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">{r.metaTitle}</div>
                          <div className="text-xs text-slate-500">Saved {fmtDate(r.createdAt)} {r.createdAt.toISOString().slice(11, 16)} UTC · asked for: {r.request.split("\n")[0].replace(/^- (\[[^\]]*\] )?/, "").slice(0, 80)}</div>
                        </div>
                        <form action={restoreRevisionAction.bind(null, r.id)}><SubmitButton className="btn-secondary px-2.5 py-1 text-xs">Restore</SubmitButton></form>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
          <QualityCard
            score={article.qualityScore}
            report={article.qualityReport as unknown as QualityReport | null}
            checkedAt={article.qualityCheckedAt}
            aiAction={runAiReviewAction.bind(null, id)}
            fixAction={!locked ? fixSopAction.bind(null, id) : undefined}
            fix={{ from: article.sopFixFrom, at: article.sopFixAt, note: article.sopFixNote }}
            busy={revising}
            canRun={editable}
            aiReady={geminiConfigured()}
          />

          <ContentScoreCard
            report={article.contentReport as unknown as ContentScore | null}
            checkedAt={article.contentCheckedAt}
            runAction={contentScoreAction.bind(null, id, false)}
            refreshAction={contentScoreAction.bind(null, id, true)}
            ready={dataforseoConfigured()}
            canRun={editable && !locked}
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
