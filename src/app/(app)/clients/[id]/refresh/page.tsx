import Link from "next/link";
import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { SubmitButton } from "@/components/submit-button";
import { RefreshWhile } from "@/components/refresh-while";
import { Spinner } from "@/components/spinner";
import { geminiConfigured } from "@/lib/gemini";
import type { RefreshBrief } from "@/lib/refresh";
import { applyRefreshAction, draftRefreshAction, scanRefreshAction, setRefreshStatusAction } from "./actions";

export const maxDuration = 300;

function List({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-slate-400">{title}</div>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

export default async function RefreshPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ scanned?: string; drafting?: string; applying?: string }> }) {
  const { id } = await params;
  const { scanned } = await searchParams;
  const user = await requireUser();
  const [editable, rows, client] = await Promise.all([
    canEdit(user, id),
    db.contentRefresh.findMany({ where: { clientId: id, status: { not: "DISMISSED" } }, orderBy: [{ status: "asc" }, { clicksBefore: "desc" }] }),
    db.client.findUniqueOrThrow({ where: { id }, select: { gscProperty: true, gscConnectionId: true } }),
  ]);
  const articleIds = rows.map((r) => r.articleId).filter(Boolean) as string[];
  const arts = await db.article.findMany({ where: { id: { in: articleIds } }, select: { id: true, metaTitle: true, status: true, revisingAt: true, importedAt: true, wpBuilder: true } });
  const art = new Map(arts.map((a) => [a.id, a]));
  const busy = rows.some((r) => (r.status === "OPEN" && !r.error && Date.now() - r.updatedAt.getTime() < 3 * 60_000 && r.brief == null && r.updatedAt > r.createdAt)) || arts.some((a) => a.revisingAt && Date.now() - a.revisingAt.getTime() < 6 * 60_000);
  const ai = geminiConfigured();
  const linked = !!client.gscProperty && !!client.gscConnectionId;

  return (
    <div className="space-y-6">
      {busy && <RefreshWhile ms={6000} />}
      <section className="card flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Content refresh</h2>
          <p className="text-sm text-slate-500">Pages whose Google clicks fell by 30% or more (last 4 weeks vs. their best 4 weeks in the 3 months before). Checked every day from Search Console.</p>
          {scanned && <p className="mt-1 text-sm text-indigo-700">Scan done: {scanned} page{scanned === "1" ? "" : "s"} losing traffic.</p>}
          {!linked && <p className="mt-1 text-sm text-amber-700">Link this client to Search Console first (Super admin → Google).</p>}
        </div>
        {editable && linked && <form action={scanRefreshAction.bind(null, id)}><SubmitButton className="btn-secondary">Scan now</SubmitButton></form>}
      </section>

      {rows.length === 0 ? (
        <p className="card text-sm text-slate-500">No pages are losing traffic right now. </p>
      ) : (
        rows.map((r) => {
          const b = r.brief as unknown as RefreshBrief | null;
          const a = r.articleId ? art.get(r.articleId) : null;
          const drop = Math.round((1 - r.clicksNow / Math.max(1, r.clicksBefore)) * 100);
          const drafting = r.status === "OPEN" && !b && !r.error && r.updatedAt > r.createdAt && Date.now() - r.updatedAt.getTime() < 3 * 60_000;
          return (
            <section key={r.id} className={`card space-y-4 ${r.status === "DONE" ? "opacity-70" : ""}`}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <a href={r.page} target="_blank" rel="noreferrer" className="block truncate font-medium text-indigo-600 hover:underline">{r.page.replace(/^https?:\/\/[^/]+/, "") || "/"}</a>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    <span className="num rounded-md bg-red-50 px-2.5 py-1 text-red-700">▼ {drop}% clicks · {r.clicksBefore} → {r.clicksNow} / 4 wks</span>
                    {r.posBefore != null && r.posNow != null && <span className="num rounded-md bg-slate-100 px-2.5 py-1 text-slate-600">position {r.posBefore.toFixed(1)} → {r.posNow.toFixed(1)}</span>}
                    {a ? <Link href={`/articles/${a.id}`} className="rounded-md bg-indigo-50 px-2.5 py-1 text-indigo-700">{a.importedAt ? "Imported from WordPress" : "Rankflow article"} · {a.status.replace(/_/g, " ").toLowerCase()}</Link> : <span className="rounded-md bg-slate-100 px-2.5 py-1 text-slate-500">Not written in Rankflow</span>}
                    {r.status === "DONE" && <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-700">Done</span>}
                  </div>
                </div>
                {editable && r.status !== "DONE" && (
                  <div className="flex flex-wrap gap-2">
                    {ai && !drafting && <form action={draftRefreshAction.bind(null, id, r.id)}><SubmitButton className={b ? "btn-secondary" : "btn-primary"}>{b ? "Redo plan" : "Plan the update"}</SubmitButton></form>}
                    <form action={setRefreshStatusAction.bind(null, id, r.id, "DISMISSED")}><SubmitButton className="btn-secondary">Dismiss</SubmitButton></form>
                  </div>
                )}
              </div>
              {drafting && <p className="flex items-center gap-2 text-sm text-indigo-700"><Spinner className="h-4 w-4" /> Reading the page and planning the update…</p>}
              {r.error && <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{r.error}</p>}
              {b && (
                <div className="space-y-4 rounded-xl bg-slate-50 p-4">
                  <p className="text-sm font-medium">{b.summary}</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <List title="Why it's slipping" items={b.why} />
                    <div className="space-y-1 text-sm">
                      <div className="text-[11px] font-medium text-slate-400">New title and description</div>
                      <p className="font-medium">{b.title}</p>
                      <p className="text-slate-600">{b.metaDescription}</p>
                    </div>
                    <List title="Add" items={b.add} />
                    <List title="Update" items={b.update} />
                    <List title="Remove" items={b.remove} />
                    <List title="FAQs to answer" items={b.faqs} />
                  </div>
                  {editable && r.status !== "DONE" && (
                    <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
                      {a && !a.wpBuilder ? (
                        a.revisingAt && Date.now() - a.revisingAt.getTime() < 6 * 60_000 ? (
                          <span className="flex items-center gap-2 text-sm text-indigo-700"><Spinner className="h-4 w-4" /> Rewriting the article…</span>
                        ) : (
                          <>
                            <form action={applyRefreshAction.bind(null, id, r.id)}><SubmitButton className="btn-primary">Rewrite the article with this plan</SubmitButton></form>
                            <span className="text-xs text-slate-500">It goes back to your review queue. After you approve it, &ldquo;Push&rdquo; updates the live WordPress post.</span>
                          </>
                        )
                      ) : (
                        <>
                          <form action={setRefreshStatusAction.bind(null, id, r.id, "DONE")}><SubmitButton className="btn-primary">Mark as updated</SubmitButton></form>
                          <span className="text-xs text-slate-500">{a?.wpBuilder ? "This page is built with a page builder, so update it in WordPress using the plan above." : <>This page isn&apos;t in Rankflow yet. Use <b>Import from WordPress</b> on the <Link href={`/clients/${id}/articles`} className="text-indigo-600 hover:underline">Articles tab</Link> to rewrite it here, or update it in WordPress using the plan above.</>}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
