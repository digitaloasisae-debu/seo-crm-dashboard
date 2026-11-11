import Link from "next/link";
import type { PulseWhy } from "@/lib/pulse-reasons";

export type Pulse = {
  id: string;
  name: string;
  site: string;
  color?: string | null;
  health: number | null;
  clicks: number | null;
  position: number | null;
  trend: number[]; // weekly clicks, oldest first
  next: string;
  waiting: number;
  why?: PulseWhy;
};

const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <div className="flex h-10 items-center text-xs text-slate-400">Search Console not linked yet</div>;
  const w = 220, h = 40;
  const mx = Math.max(...values), mn = Math.min(...values);
  const pts = values.map((v, i) => [(i * w) / (values.length - 1), h - 4 - ((v - mn) / (mx - mn || 1)) * (h - 10)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const color = up ? "var(--color-indigo-600)" : "var(--color-red-500)";
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block h-10 w-full overflow-visible" aria-hidden>
      <path d={`${d} L${w} ${h} L0 ${h}Z`} fill={color} fillOpacity={0.1} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} />
    </svg>
  );
}

export function ClientPulse({ c }: { c: Pulse }) {
  const first = c.trend.find((v) => v > 0) ?? 0;
  const lastV = c.trend.at(-1) ?? 0;
  const up = c.why ? c.why.now >= c.why.before : lastV >= first;
  const pct = c.why ? c.why.pct : first ? Math.round((lastV / first - 1) * 100) : null;
  const tone = c.health == null ? "bg-slate-100 text-slate-500" : c.health >= 80 ? "bg-emerald-50 text-emerald-700" : c.health >= 65 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
  return (
    <div className="group/why relative min-w-0 hover:z-30 focus-within:z-30">
    <Link href={`/clients/${c.id}`} className="card rf-lift block min-w-0 p-4.5 hover:border-indigo-200">
      <div className="flex items-center gap-3">
        <span className="font-display grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[13px] font-semibold text-white" style={{ background: c.color || "var(--color-indigo-600)" }}>
          {initials(c.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate leading-tight font-semibold">{c.name}</span>
          <span className="block truncate text-xs text-slate-400">{host(c.site)}</span>
        </span>
        <span title="Site health from the latest audit" className={`num shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${tone}`}>{c.health ?? "—"}</span>
      </div>
      <div className="mt-4 mb-2 flex justify-between gap-2 text-xs text-slate-500">
        <div>Clicks / wk<b className="num block text-lg font-medium text-slate-900">{c.clicks == null ? "—" : c.clicks.toLocaleString()}</b></div>
        <div>Avg. position<b className="num block text-lg font-medium text-slate-900">{c.position == null ? "—" : c.position.toFixed(1)}</b></div>
        <div data-why className="text-right">12 weeks<b className={`num block text-lg font-medium ${pct == null ? "text-slate-400" : up ? "text-emerald-600" : "text-red-600"}`}>{pct == null ? "—" : `${up ? "▲" : "▼"} ${Math.abs(pct)}%`}</b></div>
      </div>
      <Spark values={c.trend} up={up} />
      <div className="mt-3 flex justify-between gap-2 text-xs text-slate-500">
        <span>{c.waiting ? <span className="font-medium text-indigo-600">{c.waiting} waiting on you</span> : "Next post"}</span>
        <span className="truncate">{c.next}</span>
      </div>
    </Link>
    {c.why && <Why c={c} up={up} pct={pct} />}
    </div>
  );
}

const fmt = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString();

function Why({ c, pct }: { c: Pulse; up: boolean; pct: number | null }) {
  const w = c.why!;
  const tone = (b: boolean | null) => (b == null ? "text-slate-700" : b ? "text-emerald-600" : "text-red-600");
  const Movers = ({ title, rows }: { title: string; rows: PulseWhy["movers"] }) =>
    rows.length ? (
      <>
        <div className="mt-3 mb-1 text-xs font-medium text-slate-500">{title}</div>
        <ul className="space-y-1">
          {rows.map((m) => (
            <li key={m.label} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-slate-700" title={m.label}>{m.label}</span>
              <span className={`num shrink-0 font-medium ${m.now > m.before ? "text-emerald-600" : "text-red-600"}`}>{fmt(m.before)} → {fmt(m.now)}</span>
              {m.posBefore != null && m.posNow != null && <span className="num w-16 shrink-0 text-right text-slate-400">pos {m.posBefore.toFixed(0)} → {m.posNow.toFixed(0)}</span>}
            </li>
          ))}
        </ul>
      </>
    ) : null;
  return (
    <div className="pointer-events-none invisible absolute top-[calc(100%-10px)] right-2 left-2 z-30 translate-y-2 rounded-xl border border-slate-200 bg-white p-4 opacity-0 shadow-[var(--shadow-pop)] transition-all duration-200 group-hover/why:pointer-events-auto group-hover/why:visible group-hover/why:translate-y-0 group-hover/why:opacity-100">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">What changed{pct != null && <span className={pct >= 0 ? " text-emerald-600" : " text-red-600"}> {pct >= 0 ? "+" : "−"}{Math.abs(pct)}% clicks</span>}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-400">Search Console, first 4 weeks vs last 4 complete weeks</p>
      <table className="mt-2 w-full text-xs">
        <tbody>
          {w.metrics.map((m) => (
            <tr key={m.label}>
              <td className="py-0.5 text-slate-500">{m.label}</td>
              <td className="num py-0.5 text-right text-slate-500">{m.before}</td>
              <td className="px-1.5 py-0.5 text-center text-slate-300">→</td>
              <td className={`num py-0.5 text-right font-medium ${tone(m.better)}`}>{m.now}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Movers title="Searches with the biggest change (clicks a week)" rows={w.searches} />
      <Movers title="Pages with the biggest change (clicks a week)" rows={w.movers} />
      <ul className="mt-3 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-500">
        {w.facts.map((f) => <li key={f}>{f}</li>)}
      </ul>
      {w.advice.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2.5">
          <div className="text-xs font-semibold text-slate-800">Likely reasons and what to do</div>
          <p className="text-[11px] text-slate-400">Each one comes from the number shown in bold</p>
          <ol className="mt-2 space-y-2">
            {w.advice.map((a, i) => (
              <li key={i} className="text-xs leading-snug">
                <b className="font-semibold text-slate-800">{a.evidence}.</b> <span className="text-slate-600">{a.reason}</span>
                <Link href={a.href} className="mt-0.5 flex items-start gap-1 font-medium text-indigo-600 hover:underline">→ {a.fix}</Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
