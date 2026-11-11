import { Icon } from "./icons";
import type { QualityReport } from "@/lib/quality";
import type { CheckItem } from "@/lib/sop-check";
import { ScoreRing } from "./ui";
import { SubmitButton } from "./submit-button";
import { fmtDate } from "@/lib/utils";

const dot = { pass: "bg-emerald-500", warn: "bg-amber-400", fail: "bg-red-500" };
const icon = { pass: "✓", warn: "!", fail: "✕" };
const tone = { pass: "text-emerald-700 bg-emerald-50", warn: "text-amber-700 bg-amber-50", fail: "text-red-700 bg-red-50" };

function Group({ name, items }: { name: string; items: CheckItem[] }) {
  const fails = items.filter((i) => i.status === "fail").length, warns = items.filter((i) => i.status === "warn").length;
  return (
    <details open={fails > 0} className="rounded-xl border border-slate-100 bg-white/60">
      <summary className="flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-slate-50">
        <span className="flex-1">{name}</span>
        {fails > 0 && <span className="rounded-md bg-red-50 px-2 text-xs text-red-700">{fails} to fix</span>}
        {warns > 0 && <span className="rounded-md bg-amber-50 px-2 text-xs text-amber-700">{warns} to check</span>}
        {fails + warns === 0 && <span className="text-xs text-emerald-600">all good ✓</span>}
      </summary>
      <ul className="space-y-1.5 px-3 pb-3">
        {items.map((i) => (
          <li key={i.id} className="flex gap-2 text-sm">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${tone[i.status]}`}>{icon[i.status]}</span>
            <span className="min-w-0">
              <span className="block text-slate-800">{i.label}</span>
              <span className="block text-xs text-slate-500">{i.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function QualityCard({ score, report, checkedAt, aiAction, fixAction, fix, busy, canRun, aiReady }: {
  score: number | null;
  report: QualityReport | null;
  checkedAt: Date | null;
  aiAction?: () => Promise<void>;
  fixAction?: () => Promise<void>;
  fix?: { from: number | null; at: Date | null; note: string | null };
  busy?: boolean;
  canRun: boolean;
  aiReady: boolean;
}) {
  if (!report) return null;
  const all = [...report.items, ...(report.ai?.items ?? [])];
  const groups = [...new Set(all.map((i) => i.group))];
  const counts = { pass: 0, warn: 0, fail: 0 };
  all.forEach((i) => counts[i.status]++);
  return (
    <section className="card space-y-4">
      <div className="flex items-center gap-4">
        <ScoreRing score={score} size={88} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">SOP check</h2>
          <p className="text-xs text-slate-500">{report.wordCount.toLocaleString()} words{report.local ? " · local SEO rules on" : ""} · checked {fmtDate(checkedAt)}</p>
          <div className="mt-2 flex gap-3 text-xs">
            {(["pass", "warn", "fail"] as const).map((k) => <span key={k} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${dot[k]}`} />{counts[k]} {k === "pass" ? "passed" : k === "warn" ? "to check" : "to fix"}</span>)}
          </div>
        </div>
      </div>
      {fix?.at && fix.from != null && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <Icon name="check" className="h-4 w-4 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-emerald-900">
              SOP auto-fix: {fix.from} {score != null && score !== fix.from ? <>→ <span className="text-emerald-700">{score}</span></> : ""}
            </div>
            <div className="text-xs text-emerald-800/80">{fix.note ?? "Didn't finish"} · {fmtDate(fix.at)}</div>
          </div>
        </div>
      )}
      {report.ai?.summary && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><span className="mb-0.5 block text-xs font-medium text-slate-500">AI review</span>{report.ai.summary}</p>}
      {report.ai?.topFixes && report.ai.topFixes.length > 0 && (
        <div>
          <div className="label">Top fixes</div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">{report.ai.topFixes.map((f, i) => <li key={i}>{f}</li>)}</ol>
        </div>
      )}
      {report.aiError && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">AI review didn&apos;t run: {report.aiError}</p>}
      <div className="space-y-2">{groups.map((g) => <Group key={g} name={g} items={all.filter((i) => i.group === g)} />)}</div>
      {canRun && fixAction && aiReady && (counts.fail > 0 || counts.warn > 0) && (
        <form action={fixAction}>
          <SubmitButton className="btn-primary w-full" disabled={busy}>{busy ? "AI is working on it…" : "Fix SOP issues with AI"}</SubmitButton>
          <p className="mt-1 text-xs text-slate-500">Checks, fixes what&apos;s missing, then checks again. The current version is saved first.</p>
        </form>
      )}
      {canRun && aiAction && (
        <form action={aiAction}>
          <SubmitButton className="btn-secondary w-full" disabled={!aiReady}>{report.ai ? "Re-run AI review" : "Run AI review"}</SubmitButton>
          {!aiReady && <p className="mt-1 text-xs text-slate-500">Add GEMINI_API_KEY in Vercel to turn on the AI review.</p>}
        </form>
      )}
    </section>
  );
}
