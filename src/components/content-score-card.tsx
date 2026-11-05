import { ScoreRing } from "./ui";
import { ContentScoreRun } from "./content-score-run";
import { fmtDate } from "@/lib/utils";
import type { ContentScore } from "@/lib/serp";

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export function ContentScoreCard({ report, checkedAt, runAction, refreshAction, ready, canRun }: {
  report: ContentScore | null;
  checkedAt: Date | null;
  runAction: (prev: string | null) => Promise<string | null>;
  refreshAction: (prev: string | null) => Promise<string | null>;
  ready: boolean;
  canRun: boolean;
}) {
  if (!report) {
    return (
      <section className="card space-y-3">
        <h2 className="font-semibold">🏁 Content score vs Google top 10</h2>
        <p className="text-sm text-slate-500">Compares this draft with the 10 pages ranking for its focus keyword: length, headings and the terms they all use.</p>
        {!ready ? <p className="text-xs text-slate-500">Needs the DataForSEO login in Vercel.</p> : canRun && <ContentScoreRun action={runAction} label="🏁 Compare with top 10" />}
      </section>
    );
  }
  const used = report.terms.filter((t) => t.used > 0).length;
  const read = report.competitors.filter((c) => c.ok);
  return (
    <section className="card space-y-4">
      <div className="flex items-center gap-4">
        <ScoreRing score={report.score} size={88} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">🏁 Content score vs top 10</h2>
          <p className="text-xs text-slate-500">Google {report.location} · {read.length} pages read · {fmtDate(checkedAt)}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className={`rounded-xl p-2 ${report.words >= report.targetWords[0] ? "bg-emerald-50" : "bg-amber-50"}`}><div className="text-slate-500">Words</div><div className="text-lg font-bold tabular-nums">{report.words.toLocaleString()}</div><div className="text-slate-500">target {report.targetWords[0].toLocaleString()}–{report.targetWords[1].toLocaleString()}</div></div>
        <div className={`rounded-xl p-2 ${report.h2 >= report.targetH2 ? "bg-emerald-50" : "bg-amber-50"}`}><div className="text-slate-500">H2 sections</div><div className="text-lg font-bold tabular-nums">{report.h2}</div><div className="text-slate-500">target {report.targetH2}+</div></div>
        <div className={`rounded-xl p-2 ${used / Math.max(1, report.terms.length) >= 0.7 ? "bg-emerald-50" : "bg-amber-50"}`}><div className="text-slate-500">Key terms</div><div className="text-lg font-bold tabular-nums">{used}/{report.terms.length}</div><div className="text-slate-500">used</div></div>
      </div>
      <div>
        <div className="label">Terms the top pages use</div>
        <div className="flex flex-wrap gap-1.5">
          {report.terms.map((t) => (
            <span key={t.term} title={`Used by ${t.pages} of the top pages, about ${t.avg}× each. This draft: ${t.used}×`} className={`rounded-full px-2 py-0.5 text-xs ${t.used > 0 ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700 ring-1 ring-red-200 ring-inset"}`}>
              {t.term} <span className="opacity-60">{t.used}/{t.avg}</span>
            </span>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">Red = missing. Numbers = times used here / typical on top pages.</p>
      </div>
      {report.headings.length > 0 && (
        <details className="text-sm">
          <summary className="text-slate-600">Subtopics competitors cover ({report.headings.length})</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-slate-700">{report.headings.map((h) => <li key={h}>{h}</li>)}</ul>
        </details>
      )}
      <details className="text-sm">
        <summary className="text-slate-600">Top 10 pages</summary>
        <ol className="mt-2 space-y-1">
          {report.competitors.map((c) => (
            <li key={c.url} className="flex items-baseline gap-2">
              <span className="w-5 shrink-0 text-right text-xs text-slate-400">#{c.position}</span>
              <a href={c.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-indigo-600 hover:underline" title={c.title}>{c.title || host(c.url)}</a>
              <span className="shrink-0 text-xs text-slate-500">{c.ok ? `${c.words.toLocaleString()} w` : "unreadable"}</span>
            </li>
          ))}
        </ol>
      </details>
      {canRun && ready && <ContentScoreRun action={refreshAction} label="🔄 Fetch fresh top 10" className="btn-secondary w-full text-xs" />}
      <p className="text-[11px] text-slate-400">The SOP auto-fix uses these gaps too.</p>
    </section>
  );
}
