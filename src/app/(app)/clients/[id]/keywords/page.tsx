import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Empty, KeywordLink, StatusBadge } from "@/components/ui";
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
    where: {
      clientId: id,
      ...(status ? { status: status as "APPROVED" } : {}),
      ...(used ? { used: used === "true" } : {}),
    },
    orderBy: [{ used: "asc" }, { addedAt: "desc" }],
    take: 500,
  });
  const keywords = weak ? all.filter((k) => keywordFlags(k).length > 0) : all;
  const unchecked = all.filter((k) => !k.metricsCheckedAt).length;
  const weakCount = all.filter((k) => !k.used && keywordFlags(k).length > 0).length;
  const dfs = dataforseoConfigured();
  const [checkKind, ...checkRest] = (check ?? "").split(":");

  const filters = [
    { label: "All", q: "" },
    { label: "Approved, unused", q: "?status=APPROVED&used=false" },
    { label: "Pending", q: "?status=PENDING" },
    { label: "Used", q: "?used=true" },
    { label: "Rejected", q: "?status=REJECTED" },
    { label: "⚠ Weak", q: "?weak=1" },
  ];

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
          <span className="text-lg">📊</span>
          <div className="min-w-48 flex-1">
            <div className="font-semibold">Keyword check</div>
            <div className="text-xs text-slate-500">
              {dfs ? <>Search volume and difficulty from DataForSEO. New keywords are checked automatically. {unchecked > 0 ? `${unchecked} not checked yet.` : "All checked."} {weakCount > 0 && <a href="?weak=1" className="font-medium text-amber-700 hover:underline">{weakCount} unused weak keyword{weakCount === 1 ? "" : "s"}</a>}</> : "Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel to check volume and difficulty."}
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

      <div className="flex flex-wrap gap-2 text-sm">
        {filters.map((f) => <a key={f.label} href={`/clients/${id}/keywords${f.q}`} className="btn-secondary">{f.label}</a>)}
      </div>

      {keywords.length === 0 ? <Empty>No keywords match.</Empty> : (
        <form className="card overflow-x-auto p-0">
          {editable && (
            <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
              <SubmitButton data-celebrate="approved" formAction={setKeywordStatusAction.bind(null, id, "APPROVED")} className="btn-primary">Approve selected</SubmitButton>
              <SubmitButton formAction={setKeywordStatusAction.bind(null, id, "REJECTED")} className="btn-danger">Reject selected</SubmitButton>
              <SubmitButton formAction={deleteKeywordsAction.bind(null, id)} className="btn-secondary">Delete selected (unused only)</SubmitButton>
            </div>
          )}
          <table className="table">
            <thead><tr>{editable && <th></th>}<th>Keyword</th><th>Category</th><th title="Monthly Google searches in the client's country">Volume</th><th title="Keyword difficulty, 0 to 100">KD</th><th>Intent</th>{hasGsc && <th title="Average Google position and clicks, last 4 weeks (Search Console)">Position</th>}{hasGsc && <th>Clicks 4w</th>}<th>Status</th><th>Used</th><th>Added</th><th>Source</th></tr></thead>
            <tbody>
              {keywords.map((k) => (
                <tr key={k.id} className={k.used ? "text-slate-400" : ""}>
                  {editable && <td><input type="checkbox" name="ids" value={k.id} /></td>}
                  <td className="font-medium"><KeywordLink keyword={k.keyword} /></td>
                  <td>{k.category}</td>
                  <td className="whitespace-nowrap">
                    {k.searchVolume != null ? k.searchVolume.toLocaleString() : <span className="text-slate-300">—</span>}
                    {keywordFlags(k).includes("low") && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title={`Fewer than ${LOW_VOLUME} searches a month`}>low</span>}
                  </td>
                  <td>{k.difficulty != null ? <KdChip kd={k.difficulty} /> : <span className="text-slate-300">—</span>}</td>
                  <td className="text-xs text-slate-500">{k.intent ?? ""}</td>
                  {hasGsc && <td>{ranks.get(k.keywordNorm) ? ranks.get(k.keywordNorm)!.position.toFixed(1) : <span className="text-slate-300">—</span>}</td>}
                  {hasGsc && <td>{ranks.get(k.keywordNorm)?.clicks ?? ""}</td>}
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

function KdChip({ kd }: { kd: number }) {
  const c = kd >= HARD_KD ? "bg-red-50 text-red-700 ring-red-200" : kd >= 30 ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  const t = kd >= HARD_KD ? "hard" : kd >= 30 ? "medium" : "easy";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${c}`} title={t}>{kd}<span className="font-normal opacity-70">{t}</span></span>;
}
