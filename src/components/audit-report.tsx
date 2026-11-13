import type { Issue, Shot } from "@/lib/audit";
import { AUDIT_HELP } from "@/lib/audit-help";
import type { Finding } from "@/lib/prospect";
import { Badge } from "@/components/ui";

const sevColor = { error: "red", warning: "yellow", notice: "gray" } as const;
const sevLabel = { error: "Urgent", warning: "Important", notice: "Worth fixing" } as const;

/** Page screenshots (from Google PageSpeed), each with the problems found on that page. */
export function Screenshots({ shots }: { shots: Shot[] }) {
  if (!shots.length) return null;
  return (
    <section className="card space-y-3 print:break-inside-avoid">
      <div>
        <h2 className="font-semibold">What the pages look like</h2>
        <p className="text-sm text-slate-500">Screenshots taken by Google PageSpeed while loading each page, with the problems found on it.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {shots.map((s) => (
          <figure key={`${s.url}-${s.device}`} className={`min-w-0 space-y-1.5 ${s.device === "desktop" ? "col-span-2" : ""}`}>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.image} alt={`${s.label} on ${s.device}`} className="block h-auto w-full" />
            </div>
            <figcaption className="space-y-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <a href={s.url} target="_blank" rel="noreferrer" className="truncate font-medium text-slate-800 hover:underline">{s.label}</a>
                <span className="shrink-0 text-slate-500">{s.device}{s.performance != null && <> · speed <b className={s.performance >= 90 ? "text-emerald-600" : s.performance >= 50 ? "text-amber-600" : "text-red-600"}>{s.performance}</b></>}</span>
              </div>
              {s.problems.length > 0 && <ul className="space-y-0.5 text-red-700">{s.problems.slice(0, 4).map((p) => <li key={p}>✕ {p}</li>)}{s.problems.length > 4 && <li className="text-slate-500">+{s.problems.length - 4} more</li>}</ul>}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

/** Quick-audit issues as client-facing findings. */
export function findingsFromIssues(issues: Issue[], pagesChecked: number): Finding[] {
  return issues.filter((i) => AUDIT_HELP[i.code]).map((i) => ({ code: i.code, severity: i.severity, title: i.title, urls: i.urls, evidence: i.count > 1 ? `${i.count} of ${pagesChecked} pages checked` : "", ...AUDIT_HELP[i.code] }));
}

/** Problems found, what each costs the business, and how we fix it. */
export function Findings({ findings, title = "Problems we found and how we can help" }: { findings: Finding[]; title?: string }) {
  if (!findings.length) return <section className="card text-sm text-slate-500">No problems found.</section>;
  const services = [...new Set(findings.map((f) => f.service))];
  return (
    <section className="card p-0">
      <div className="space-y-1 p-4 pb-2">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-slate-500">{findings.length} problem{findings.length === 1 ? "" : "s"}: {findings.filter((f) => f.severity === "error").length} urgent, {findings.filter((f) => f.severity === "warning").length} important. Services involved: {services.join(", ")}.</p>
      </div>
      <ol className="divide-y divide-slate-100">
        {findings.map((f, n) => (
          <li key={f.code + n} className="space-y-2 px-4 py-3 print:break-inside-avoid">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge color={sevColor[f.severity]}>{sevLabel[f.severity]}</Badge>
              <span className="font-medium text-slate-900">{f.title}</span>
              {f.evidence && <span className="text-xs text-slate-500">{f.evidence}</span>}
            </div>
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <p className="rounded-lg bg-red-50/70 p-2.5 text-red-900"><span className="block text-xs font-semibold tracking-wide text-red-700 uppercase">What it means</span>{f.impact}</p>
              <p className="rounded-lg bg-emerald-50/70 p-2.5 text-emerald-900"><span className="block text-xs font-semibold tracking-wide text-emerald-700 uppercase">How we can help</span>{f.help}</p>
            </div>
            {f.urls.length > 0 && (
              <details className="text-xs print:hidden">
                <summary className="cursor-pointer text-slate-500">Pages ({f.urls.length})</summary>
                <ul className="mt-1 space-y-0.5 pl-2 break-all text-slate-600">{f.urls.map((u) => <li key={u}><a className="hover:underline" href={u.split(" (on ")[0]} target="_blank" rel="noreferrer">{u}</a></li>)}</ul>
              </details>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

type Psi = { performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null; lcpMs: number | null; cls: number | null } | null;

/** Google PageSpeed scores for mobile and desktop, side by side. */
export function SpeedScores({ mobile, desktop }: { mobile: Psi; desktop: Psi }) {
  const rows: [string, (p: NonNullable<Psi>) => string | number | null][] = [
    ["Performance", (p) => p.performance],
    ["SEO", (p) => p.seo],
    ["Accessibility", (p) => p.accessibility],
    ["Best practices", (p) => p.bestPractices],
    ["Main content shows (LCP)", (p) => (p.lcpMs != null ? `${(p.lcpMs / 1000).toFixed(1)}s` : null)],
    ["Layout shift (CLS)", (p) => (p.cls != null ? p.cls.toFixed(2) : null)],
  ];
  const tone = (v: string | number | null) => (typeof v !== "number" ? "text-slate-700" : v >= 90 ? "text-emerald-600" : v >= 50 ? "text-amber-600" : "text-red-600");
  return (
    <section className="card p-0 print:break-inside-avoid">
      <h2 className="p-4 pb-2 font-semibold">Google PageSpeed (home page)</h2>
      <table className="table">
        <thead><tr><th></th><th className="text-right">Mobile</th><th className="text-right">Desktop</th></tr></thead>
        <tbody>
          {rows.map(([label, get]) => {
            const m = mobile ? get(mobile) : null, d = desktop ? get(desktop) : null;
            return <tr key={label}><td>{label}</td><td className={`num text-right font-medium ${tone(m)}`}>{m ?? "—"}</td><td className={`num text-right font-medium ${tone(d)}`}>{d ?? "—"}</td></tr>;
          })}
        </tbody>
      </table>
    </section>
  );
}
