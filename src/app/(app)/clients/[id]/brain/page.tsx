import { Icon } from "@/components/icons";
import Link from "next/link";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Empty } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { fmtDate } from "@/lib/utils";
import { learnRankingsAction, relearnBrainAction, saveBrainAction } from "../../../../actions";
import { geminiConfigured } from "@/lib/gemini";

export const maxDuration = 60;

export default async function BrainPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ learn?: string }> }) {
  const { id } = await params;
  const { learn } = await searchParams;
  const user = await requireUser();
  const [brain, editable, notes, pending] = await Promise.all([
    db.clientBrain.findUnique({ where: { clientId: id } }),
    canEdit(user, id),
    db.articleNote.findMany({ where: { clientId: id }, include: { author: { select: { name: true } }, article: { select: { id: true, metaTitle: true } } }, orderBy: { createdAt: "desc" }, take: 15 }),
    db.articleNote.count({ where: { clientId: id, learnedAt: null } }),
  ]);
  const html = brain?.rules ? sanitizeHtml(await marked.parse(brain.rules)) : "";
  const ai = geminiConfigured();

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className="card relative overflow-hidden">
          <div className="relative flex flex-wrap items-start gap-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700"><Icon name="brain" className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold tracking-tight">Writing rules</h2>
              <p className="text-sm text-slate-500">Rankflow turns your team&apos;s notes on this client&apos;s blogs into writing rules, and n8n follows them to write every new blog for this client.</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-md bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700">Version {brain?.version ?? 0}</span>
                <span className="rounded-md bg-slate-100 px-2.5 py-1 text-slate-600">Last learned {brain?.lastLearnedAt ? fmtDate(brain.lastLearnedAt) : "never"}</span>
                {pending > 0 && <span className="rounded-md bg-amber-50 px-2.5 py-1 font-medium text-amber-700">{pending} note{pending > 1 ? "s" : ""} waiting to be learned</span>}
              </div>
            </div>
          </div>
          {learn && (
            <p className={`relative mt-4 rounded-xl p-3 text-sm ${learn.startsWith("err:") ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
              {learn.startsWith("err:") ? `Couldn't learn: ${learn.slice(4)}` : learn.startsWith("skip:") ? `Not enough Google data yet: ${learn.slice(5)}.` : learn === "nothing" ? "No new notes to learn from." : `Learned! ${learn.split(":")[1] ?? 0} rule changes.`}
            </p>
          )}
          {brain?.lastError && !learn && <p className="relative mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Last learning attempt failed: {brain.lastError}</p>}
        </section>

        <section className="card">
          <h3 className="mb-3 font-semibold">What it has learned</h3>
          {html ? <div className="prose-preview text-sm" dangerouslySetInnerHTML={{ __html: html }} /> : <Empty>Nothing yet. Leave notes on this client&apos;s articles and the brain will start learning.</Empty>}
        </section>

        {editable && (
          <details className="card">
            <summary className="font-semibold">Edit the rules by hand</summary>
            <form action={saveBrainAction.bind(null, id)} className="mt-4 space-y-3">
              <textarea className="input font-mono text-xs" name="rules" rows={16} defaultValue={brain?.rules ?? ""} placeholder={"## Voice & tone\n- Friendly, expert, no hype\n\n## Never do\n- Never mention competitors by name"} />
              <SubmitButton className="btn-primary">Save rules</SubmitButton>
            </form>
          </details>
        )}
      </div>

      <div className="space-y-6">
        {editable && (
          <section className="card space-y-2">
            <h3 className="font-semibold">Teach it</h3>
            <form action={relearnBrainAction.bind(null, id, false)}><SubmitButton className="btn-primary w-full" disabled={!ai}>Learn from new notes</SubmitButton></form>
            <form action={relearnBrainAction.bind(null, id, true)}><SubmitButton className="btn-secondary w-full" disabled={!ai}>Rebuild from all notes</SubmitButton></form>
            {!ai && <p className="text-xs text-slate-500">Add GEMINI_API_KEY in Vercel to turn learning on.</p>}
            <form action={learnRankingsAction.bind(null, id)}><SubmitButton className="btn-secondary w-full" disabled={!ai}>Learn from Google rankings</SubmitButton></form>
            <p className="text-xs text-slate-500">It learns from each new note a few seconds after it&apos;s added. Once a week it also compares this client&apos;s best and worst ranking posts in Search Console.</p>
            {brain?.rankingsLearnedAt && <p className="text-xs text-slate-400">Last learned from rankings {fmtDate(brain.rankingsLearnedAt)}.</p>}
          </section>
        )}
        <section className="card">
          <h3 className="mb-3 font-semibold">Recent notes</h3>
          {notes.length === 0 ? <p className="text-sm text-slate-500">No notes yet.</p> : (
            <ul className="space-y-3 text-sm">
              {notes.map((n) => (
                <li key={n.id}>
                  <div className="text-xs text-slate-500"><span className="font-medium text-slate-700">{n.author?.name ?? "Someone"}</span> on <Link className="text-indigo-600 hover:underline" href={`/articles/${n.article.id}`}>{n.article.metaTitle}</Link></div>
                  <p className="text-slate-800">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
