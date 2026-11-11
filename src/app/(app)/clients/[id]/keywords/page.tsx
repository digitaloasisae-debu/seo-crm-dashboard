import { clientArticles, usageIndex } from "@/lib/keyword-usage";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { KeywordLink, RankChange, StatusBadge } from "@/components/ui";
import { DataTable, type Col, type Row } from "@/components/data-table";
import { fmtDate } from "@/lib/utils";
import { keywordPositions } from "@/lib/gsc-report";
import { addKeywordsAction, checkKeywordsAction, deleteKeywordsAction, setKeywordStatusAction } from "../../../../actions";
import { HARD_KD, LOW_VOLUME, dataforseoConfigured, keywordFlags } from "@/lib/dataforseo";
import { SubmitButton } from "@/components/submit-button";

export default async function KeywordsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; used?: string; weak?: string; check?: string }> }) {
  const { id } = await params;
  const { status, used, weak, check } = await searchParams;
  const user = await requireUser();
  const [editable, ranks] = await Promise.all([canEdit(user, id), keywordPositions(id)]);
  const hasGsc = ranks.size > 0;
  const all = await db.keyword.findMany({
    where: { clientId: id },
    orderBy: [{ used: "asc" }, { addedAt: "desc" }],
    take: 3000,
  });
  const usedBy = usageIndex(await clientArticles(id));
  const initial = { ...(status ? { status: [status] } : {}), ...(used ? { used: [used === "true" ? "Used" : "Not used"] } : {}), ...(weak ? { flag: ["Weak"] } : {}) };
  const unchecked = all.filter((k) => !k.metricsCheckedAt).length;
  const weakCount = all.filter((k) => !k.used && keywordFlags(k).length > 0).length;
  const dfs = dataforseoConfigured();
  const [checkKind, ...checkRest] = (check ?? "").split(":");

  return (
    <div className="space-y-6">
      {editable && (
        <form action={addKeywordsAction.bind(null, id)} className="card flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1"><span className="label">Add keywords (comma or one per line)</span><textarea className="input" name="keywords" rows={2} required /></label>
          <label className="w-48"><span className="label">Category (optional)</span><input className="input" name="category" /></label>
          <SubmitButton className="btn-primary">Add</SubmitButton>
        </form>
      )}

      {editable && (
        <div className="card flex flex-wrap items-center gap-3 text-sm">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600"><Icon name="gauge" className="h-4 w-4" /></span>
          <div className="min-w-48 flex-1">
            <div className="font-semibold">Keyword check</div>
            <div className="text-xs text-slate-500">
              {dfs ? <>Search volume from Google Keyword Planner, difficulty from DataForSEO. New keywords are checked automatically. {unchecked > 0 ? `${unchecked} not checked yet.` : "All checked."} {weakCount > 0 && <a href={`/clients/${id}/keywords?weak=1&used=false`} className="font-medium text-amber-700 hover:underline">{weakCount} unused weak keyword{weakCount === 1 ? "" : "s"}</a>}</> : "Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel to check volume and difficulty."}
            </div>
          </div>
          {dfs && (
            <form className="flex gap-2">
              {unchecked > 0 && <SubmitButton formAction={checkKeywordsAction.bind(null, id, false)} className="btn-primary">Check {unchecked} new</SubmitButton>}
              <SubmitButton formAction={checkKeywordsAction.bind(null, id, true)} className="btn-secondary">Recheck all</SubmitButton>
            </form>
          )}
          {checkKind === "ok" && <p className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">✓ Checked {checkRest[0]} keyword{checkRest[0] === "1" ? "" : "s"} for {checkRest.slice(1).join(":")}.</p>}
          {checkKind === "err" && <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-red-700">Check failed: {checkRest.join(":")}</p>}
        </div>
      )}

      <form>
        <DataTable
          id="keywords"
          columns={[
            { key: "keyword", label: "Keyword", className: "min-w-44" },
            { key: "category", label: "Category", type: "enum" },
            { key: "volume", label: "Volume", type: "number", title: "Monthly Google searches in the client's country" },
            { key: "kd", label: "KD", type: "number", title: "Keyword difficulty, 0 to 100" },
            { key: "intent", label: "Intent", type: "enum" },
            ...(hasGsc ? [{ key: "position", label: "Position", type: "number" as const, title: "Average Google position, last 4 weeks (Search Console)" }, { key: "clicks", label: "Clicks 4w", type: "number" as const }] : []),
            { key: "status", label: "Status", type: "enum" },
            { key: "used", label: "Used", type: "enum" },
            { key: "usedBy", label: "Used by blog", title: "Blogs on this site whose focus keyword is the same (or ≈ similar)" },
            { key: "flag", label: "Check", type: "enum", title: "Weak = low volume or hard to rank" },
            { key: "added", label: "Added", type: "date" },
            { key: "source", label: "Source", type: "enum", hidden: true },
          ] satisfies Col[]}
          rows={all.map((k): Row => {
            const r = ranks.get(k.keywordNorm);
            const flags = keywordFlags(k);
            const blogs = usedBy(k.keyword);
            const same = blogs.filter((b) => b.match === "same");
            return {
              id: k.id,
              className: k.used ? "text-slate-400" : "",
              values: {
                keyword: k.keyword, category: k.category ?? "", volume: k.searchVolume, kd: k.difficulty, intent: k.intent ?? "",
                position: r ? Number(r.position.toFixed(1)) : null, clicks: r?.clicks ?? null,
                status: k.status, used: k.used ? "Used" : same.length ? "In a blog" : "Not used", usedBy: blogs.map((b) => b.title).join(" | "), flag: !k.metricsCheckedAt ? "Not checked" : flags.length ? "Weak" : "OK",
                added: k.addedAt.toISOString(), source: k.source.toLowerCase(),
              },
              cells: {
                keyword: <span className="font-medium"><KeywordLink keyword={k.keyword} /></span>,
                volume: <span className="num whitespace-nowrap">{k.searchVolume != null ? k.searchVolume.toLocaleString() : <span className="text-slate-300">—</span>}{flags.includes("low") && <span className="ml-1.5 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title={`Fewer than ${LOW_VOLUME} searches a month`}>low</span>}</span>,
                kd: k.difficulty != null ? <KdChip kd={k.difficulty} /> : <span className="text-slate-300">—</span>,
                intent: <span className="text-xs text-slate-500">{k.intent ?? ""}</span>,
                position: r ? <span className="num whitespace-nowrap">{r.position.toFixed(1)} <RankChange position={r.position} prev={r.prevPosition} /></span> : <span className="text-slate-300">—</span>,
                status: <StatusBadge status={k.status} />,
                used: k.used ? <span className="whitespace-nowrap text-xs">{fmtDate(k.usedAt) || "yes"}</span> : same.length ? <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-amber-700" data-tip="A blog already targets this keyword">in a blog</span> : <span className="text-xs text-slate-400">no</span>,
                usedBy: blogs.length ? (
                  <div className="max-w-64 space-y-0.5">
                    {blogs.slice(0, 3).map((b) => (
                      <Link key={b.id} href={`/articles/${b.id}`} className={`block truncate text-xs hover:underline ${b.match === "same" ? "text-indigo-600" : "text-slate-500"}`} title={`${b.title} (focus keyword: ${b.keyword})`}>
                        {b.match === "similar" && "≈ "}{b.title}
                      </Link>
                    ))}
                    {blogs.length > 3 && <span className="text-[11px] text-slate-400">+{blogs.length - 3} more</span>}
                  </div>
                ) : <span className="text-slate-300">—</span>,
                flag: !k.metricsCheckedAt ? <span className="text-xs text-slate-400">not checked</span> : flags.length ? <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">weak</span> : <span className="text-xs text-emerald-600">ok</span>,
                added: <span className="whitespace-nowrap">{fmtDate(k.addedAt)}</span>,
                source: <span className="text-xs">{k.source.toLowerCase()}{k.submittedBy ? ` · ${k.submittedBy}` : ""}</span>,
              },
              selectable: editable,
            };
          })}
          initialFilters={initial}
          presets={[
            { label: "Approved, unused", filters: { status: ["APPROVED"], used: ["Not used"] } },
            { label: "Pending", filters: { status: ["PENDING"] } },
            { label: "Used", filters: { used: ["Used"] } },
            { label: "Already in a blog", filters: { used: ["In a blog"] }, tone: "text-amber-700" },
            { label: "Rejected", filters: { status: ["REJECTED"] } },
            { label: "Weak", filters: { flag: ["Weak"], used: ["Not used"] } },
          ]}
          searchPlaceholder="Search keywords"
          empty="No keywords yet. Add some above or send them through the Tally form."
          bulk={editable ? (
            <>
              <SubmitButton data-celebrate="approved" formAction={setKeywordStatusAction.bind(null, id, "APPROVED")} className="btn-primary px-3 py-1.5 text-xs">Approve</SubmitButton>
              <SubmitButton formAction={setKeywordStatusAction.bind(null, id, "REJECTED")} className="btn-danger px-3 py-1.5 text-xs">Reject</SubmitButton>
              <SubmitButton formAction={deleteKeywordsAction.bind(null, id)} className="btn-secondary px-3 py-1.5 text-xs">Delete (unused only)</SubmitButton>
            </>
          ) : undefined}
        />
      </form>
    </div>
  );
}

function KdChip({ kd }: { kd: number }) {
  const c = kd >= HARD_KD ? "bg-red-50 text-red-700 ring-red-200" : kd >= 30 ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  const t = kd >= HARD_KD ? "hard" : kd >= 30 ? "medium" : "easy";
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${c}`} title={t}>{kd}<span className="font-normal opacity-70">{t}</span></span>;
}
