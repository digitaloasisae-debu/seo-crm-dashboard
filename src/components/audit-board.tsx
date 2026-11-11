"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

export type BoardIssue = { code: string; severity: "error" | "warning" | "notice"; title: string; hint: string; count: number; aiReady: boolean; isNew: boolean };
type Cat = { label: string; score: number };

const GROUPS = [
  { sev: "error", label: "High impact", bar: "bg-red-500", chip: "bg-red-50 text-red-700" },
  { sev: "warning", label: "Worth fixing", bar: "bg-amber-500", chip: "bg-amber-50 text-amber-700" },
  { sev: "notice", label: "Nice to have", bar: "bg-slate-400", chip: "bg-slate-100 text-slate-600" },
] as const;
const W = { error: 3, warning: 1.4, notice: 0.4 };
const C = 2 * Math.PI * 86;

function useCount(to: number, ms = 900) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setV(to);
    const start = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      const cur = Math.round(start + (to - start) * e);
      setV(cur);
      from.current = cur;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return v;
}

/**
 * Site health dial with a "what if I fix these" simulator, and the issue list as a calm,
 * prioritised board. Each issue opens a side panel with the full details (rendered on the server).
 */
export function AuditBoard({ score, pages, date, issues, cats, details, checks, initialOpen }: {
  score: number;
  pages: number;
  date: string;
  issues: BoardIssue[];
  cats: Cat[];
  details: Record<string, React.ReactNode>;
  checks: React.ReactNode;
  initialOpen?: string;
}) {
  // Estimated score gain per issue: the gap to 100 shared out by severity and how many pages it hits.
  const gains = useMemo(() => {
    const w = issues.map((i) => W[i.severity] * Math.log2(1 + i.count));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    return Object.fromEntries(issues.map((i, k) => [i.code, ((100 - score) * w[k]) / sum]));
  }, [issues, score]);
  const [sim, setSim] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(initialOpen ?? null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(t);
  }, []);
  const gain = Math.min(100 - score, Math.round([...sim].reduce((a, c) => a + (gains[c] ?? 0), 0)));
  const shown = useCount(score + gain, sim.size ? 500 : 1100);
  const tone = score >= 80 ? "var(--color-emerald-500)" : score >= 60 ? "var(--color-amber-500)" : "var(--color-red-500)";
  const toggle = (code: string) => setSim((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const cur = issues.find((i) => i.code === open);

  return (
    <section className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="card p-6 lg:sticky lg:top-20">
        <div className="relative mx-auto h-[200px] w-[200px]">
          <svg width="200" height="200" viewBox="0 0 200 200" className="-rotate-90" aria-hidden>
            <circle cx="100" cy="100" r="86" fill="none" stroke="var(--color-slate-100)" strokeWidth="14" />
            <circle cx="100" cy="100" r="86" fill="none" stroke="var(--color-emerald-500)" strokeOpacity={0.35} strokeWidth="14" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - (score + gain) / 100)} style={{ transition: "stroke-dashoffset .8s var(--ease-out-soft)" }} />
            <circle cx="100" cy="100" r="86" fill="none" stroke={tone} strokeWidth="14" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={drawn ? C * (1 - score / 100) : C} style={{ transition: "stroke-dashoffset 1.1s var(--ease-out-soft)" }} />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <b className="font-display block text-6xl leading-none font-semibold tracking-tight">{shown}</b>
              <span className="text-xs text-slate-500">{gain ? "after these fixes" : "Site health"}</span>
            </div>
          </div>
        </div>
        <p className="mt-2 mb-5 min-h-10 text-center text-sm text-slate-500">
          {gain ? <>If you fix the selected issues: <b className="num text-emerald-600">{score} → {score + gain}</b> (estimate)</> : <>{pages.toLocaleString()} pages · {date}<br />Switch issues on to see your new score</>}
        </p>
        {cats.length > 0 && (
          <div className="grid gap-2.5">
            {cats.map((c, i) => (
              <div key={c.label} className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-[13px]">
                <span className="truncate">{c.label}</span>
                <span className="num">{c.score}</span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <i className={`block h-full rounded-full ${c.score >= 80 ? "bg-emerald-500" : c.score >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: drawn ? `${c.score}%` : 0, transition: `width .9s var(--ease-out-soft) ${i * 60}ms` }} />
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-5 border-t border-slate-100 pt-4">{checks}</div>
      </div>

      <div className="card p-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5 pb-1">
          <h2 className="font-sans text-base font-semibold tracking-normal">Fix these next</h2>
          <span className="text-xs text-slate-500">{issues.length} issues · biggest score lift first</span>
        </div>
        {issues.length === 0 && <p className="px-4 py-8 text-center text-sm text-emerald-700">No issues found. </p>}
        {GROUPS.map((g) => {
          const list = issues.filter((i) => i.severity === g.sev).sort((a, b) => (gains[b.code] ?? 0) - (gains[a.code] ?? 0));
          if (!list.length) return null;
          return (
            <div key={g.sev}>
              <div className="px-4 pt-4 pb-1 text-[11px] font-medium text-slate-400">{g.label}</div>
              {list.map((i) => {
                const on = sim.has(i.code);
                const g1 = Math.round((gains[i.code] ?? 0) * 10) / 10;
                return (
                  <div
                    key={i.code}
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpen(i.code)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(i.code))}
                    className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3.5 rounded-xl px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50"
                  >
                    <span className={`h-8 w-1 rounded-full ${g.bar}`} />
                    <span className="min-w-0">
                      <span className={`block truncate text-sm font-medium transition-colors ${on ? "text-slate-400 line-through" : ""}`}>{i.title}</span>
                      <span className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                        <span>{i.count.toLocaleString()} page{i.count === 1 ? "" : "s"}</span>
                        {i.isNew && <span className="font-medium text-red-600">New</span>}
                        {i.aiReady && <span className="font-medium text-indigo-600">AI fix ready</span>}
                      </span>
                    </span>
                    <span className="num hidden rounded-md bg-emerald-50 px-2 py-0.5 text-xs whitespace-nowrap text-emerald-700 sm:inline">{g1 >= 0.5 ? `+${Math.round(g1)}` : "<1"} pts</span>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`Simulate fixing: ${i.title}`}
                      title="Simulate fixing this"
                      onClick={(e) => (e.stopPropagation(), toggle(i.code))}
                      className={`relative h-5 w-9 cursor-pointer rounded-full transition-colors duration-200 ${on ? "bg-emerald-500" : "bg-slate-200"}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-300 [transition-timing-function:var(--ease-spring)] dark:bg-slate-900 ${on ? "translate-x-4" : ""}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className="h-2" />
      </div>

      {cur && createPortal(<Drawer issue={cur} gain={gains[cur.code] ?? 0} onClose={() => setOpen(null)}>{details[cur.code]}</Drawer>, document.body)}
    </section>
  );
}

function Drawer({ issue, gain, onClose, children }: { issue: BoardIssue; gain: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const g = GROUPS.find((x) => x.sev === issue.severity)!;
  return (
    <>
      <div className="fixed inset-0 z-[55] animate-fade-in bg-slate-950/25 dark:bg-black/50" onClick={onClose} />
      <aside ref={ref} tabIndex={-1} role="dialog" aria-label={issue.title} className="rf-drawer fixed top-0 right-0 bottom-0 z-[56] w-full max-w-[520px] overflow-y-auto bg-white p-6 outline-none md:p-7" style={{ boxShadow: "var(--shadow-pop)" }}>
        <div className="flex items-center justify-between gap-3">
          <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${g.chip}`}>{g.label}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 cursor-pointer place-items-center rounded-xl border border-slate-200 text-slate-500 hover:text-slate-900">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        <h3 className="font-display mt-4 text-2xl leading-tight font-semibold text-balance">{issue.title}</h3>
        <p className="mt-1 text-sm text-slate-500">
          {issue.count.toLocaleString()} page{issue.count === 1 ? "" : "s"} · fixing it lifts site health by about <b className="num text-emerald-600">+{Math.max(1, Math.round(gain))}</b>
        </p>
        <div className="mt-5">{children}</div>
      </aside>
    </>
  );
}
