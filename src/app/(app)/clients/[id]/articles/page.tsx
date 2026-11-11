import Link from "next/link";
import { db } from "@/lib/db";
import { RankChange, StatusBadge } from "@/components/ui";
import { DataTable, type Col, type Row } from "@/components/data-table";
import { articleRanks, matchArticleSlug } from "@/lib/gsc-report";
import { fmtDate } from "@/lib/utils";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { SubmitButton } from "@/components/submit-button";
import { importWordPressAction } from "./actions";

export const maxDuration = 120;

export default async function ArticlesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ imported?: string; synced?: string; partial?: string; importErr?: string }> }) {
  const { id } = await params;
  const { imported, synced, partial, importErr } = await searchParams;
  const user = await requireUser();
  const [editable, hasWp, nImported, nOwn] = await Promise.all([
    canEdit(user, id),
    db.clientCredential.findUnique({ where: { clientId_kind: { clientId: id, kind: "WORDPRESS" } }, select: { id: true } }).then(Boolean),
    db.article.count({ where: { clientId: id, importedAt: { not: null } } }),
    db.article.count({ where: { clientId: id, importedAt: null } }),
  ]);
  const articles = await db.article.findMany({
    where: { clientId: id },
    orderBy: { createdAt: "desc" },
    include: { postingSlot: true },
    take: 1000,
  });
  const [ranks, client] = await Promise.all([articleRanks(id), db.client.findUniqueOrThrow({ where: { id }, select: { gscProperty: true, gscSyncedAt: true } })]);
  const hasRanks = !!client.gscProperty;
  const rankOf = (a: (typeof articles)[number]) => { const m = matchArticleSlug(a, ranks.keys()); return m ? ranks.get(m) : undefined; };
  const score = (v: number | null, good: number, ok: number) => v == null ? <span className="text-slate-300">—</span> : <span className={`num inline-flex min-w-9 justify-center rounded-full px-2 py-0.5 text-xs font-bold ${v >= good ? "bg-emerald-50 text-emerald-700" : v >= ok ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{v}</span>;
  const columns: Col[] = [
    { key: "title", label: "Title", className: "min-w-56" },
    { key: "keyword", label: "Focus keyword", className: "min-w-44" },
    { key: "status", label: "Status", type: "enum" },
    { key: "source", label: "Source", type: "enum" },
    { key: "sop", label: "SOP", type: "number", title: "SOP check score" },
    { key: "top10", label: "Top 10", type: "number", title: "Content score vs Google top 10" },
    ...(hasRanks ? [{ key: "google", label: "Google", type: "number" as const, title: "Average Google position of the post, last 4 weeks (Search Console)" }] : []),
    { key: "scheduled", label: "Scheduled", type: "date" },
    { key: "wp", label: "WordPress", sortable: false },
    { key: "created", label: "Created", type: "date" },
    { key: "slug", label: "Slug", hidden: true },
  ];
  const rows: Row[] = articles.map((a) => {
    const r = rankOf(a);
    const live = a.importedAt && a.status === "PUSHED_DRAFT";
    return {
      id: a.id,
      values: {
        title: a.metaTitle,
        keyword: a.focusKeyword,
        status: live ? "LIVE" : a.status,
        source: a.importedAt ? (a.wpType === "page" ? (a.wpBuilder ? "WP page (builder)" : "WP page") : "WP post") : "Rankflow",
        sop: a.qualityScore,
        top10: a.contentScore,
        google: r ? Number(r.position.toFixed(1)) : null,
        scheduled: a.postingSlot?.scheduledDate.toISOString() ?? null,
        wp: a.wpPostUrl ?? "",
        created: a.createdAt.toISOString(),
        slug: a.slug,
      },
      cells: {
        title: <Link className="font-medium text-indigo-600 hover:underline" href={`/articles/${a.id}`}>{a.metaTitle}</Link>,
        status: live ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">live</span> : <StatusBadge status={a.status} />,
        source: <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${a.importedAt ? "bg-slate-100 text-slate-600" : "bg-violet-50 text-violet-700"}`}>{a.importedAt ? (a.wpType === "page" ? "WP page" : "WP post") + (a.wpBuilder ? " · builder" : "") : "Rankflow"}</span>,
        sop: score(a.qualityScore, 85, 65),
        top10: score(a.contentScore, 75, 55),
        google: r ? <span className="num whitespace-nowrap">#{r.position.toFixed(1)} <RankChange position={r.position} prev={r.prevPosition} /></span> : <span className="text-slate-300" title="Not found in Google results for the last 4 weeks">—</span>,
        scheduled: fmtDate(a.postingSlot?.scheduledDate) || <span className="text-slate-300">—</span>,
        wp: a.wpPostUrl ? <a className="whitespace-nowrap text-indigo-600 hover:underline" href={a.wpPostUrl} target="_blank" rel="noreferrer">{a.importedAt ? "view" : "draft"} #{a.wpPostId}</a> : <span className="text-slate-300">—</span>,
        created: <span className="whitespace-nowrap">{fmtDate(a.createdAt)}</span>,
      },
    };
  });
  return (
    <div className="space-y-3">
      {(editable || nImported > 0) && (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1 text-sm text-slate-500"><b className="font-medium text-slate-800">{nOwn}</b> written in Rankflow · <b className="font-medium text-slate-800">{nImported}</b> imported from WordPress</div>
          {editable && (hasWp ? (
            <form action={importWordPressAction.bind(null, id)} className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" name="pages" defaultChecked className="accent-indigo-600" /> Include pages</label>
              <SubmitButton className="btn-secondary text-sm">↓ {nImported ? "Sync from WordPress" : "Import from WordPress"}</SubmitButton>
            </form>
          ) : <span className="text-xs text-slate-500">Save the WordPress login on the <Link href={`/clients/${id}/settings`} className="text-indigo-600 hover:underline">Settings tab</Link> to import older posts.</span>)}
        </div>
      )}
      {importErr && <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{importErr}</p>}
      {imported != null && <p className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Imported {imported} new and refreshed {synced ?? 0} from WordPress.{partial && " There's more: press Sync again to continue."} The Refresh tab can now rewrite them.</p>}
      {!client.gscProperty && <p className="rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-600">Google rankings appear here once this client is linked to Search Console on the <Link className="text-indigo-600 hover:underline" href="/google">Google</Link> page.</p>}
      {client.gscProperty && ranks.size === 0 && <p className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800">No ranking history yet. Open the <Link className="font-medium underline" href={`/clients/${id}/seo`}>SEO tab</Link> and click <b>Refresh now</b> once to load it.</p>}
      <DataTable
        id={`articles`}
        columns={columns}
        rows={rows}
        searchPlaceholder="Search title, keyword, slug"
        presets={[
          { label: "To review", filters: { status: ["READY_FOR_REVIEW"] } },
          { label: "Ready to push", filters: { status: ["APPROVED", "PUSH_FAILED"] } },
          { label: "Written in Rankflow", filters: { source: ["Rankflow"] } },
          { label: "Imported", filters: { source: ["WP post", "WP page", "WP page (builder)"] } },
          { label: "Low SOP score", filters: { sop: "<65" } },
        ]}
        empty="No articles yet. n8n WF2 writes them from approved topics, or import older posts from WordPress."
      />
    </div>
  );
}
