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
  // Same numbers as the hover card: average of the last 4 complete weeks, vs the first 4 weeks of the 12.
  const clicksNow = c.why ? c.why.now : c.clicks;
  const clicksBefore = c.why ? c.why.before : first || null;
  const pos = c.why?.metrics.find((m) => m.label === "Average position");
  const posNow = pos && pos.now !== "—" ? Number(pos.now) : c.position;
  const posBefore = pos && pos.before !== "—" ? Number(pos.before) : null;
  const posBetter = posNow != null && posBefore != null ? (Math.abs(posNow - posBefore) < 0.5 ? null : posNow < posBefore) : null;
  const healthTone = c.health == null ? "bg-slate-100 text-slate-500" : c.health >= 80 ? "bg-emerald-50 text-emerald-700" : c.health >= 65 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
  const flat = pct != null && Math.abs(pct) < 5;
  const chip = pct == null ? "bg-slate-100 text-slate-500" : flat ? "bg-slate-100 text-slate-600" : up ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700";
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
        {c.health != null && <span data-tip="Site health score from the latest SEO audit, out of 100" className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${healthTone}`}>Health <b className="num">{c.health}</b></span>}
      </div>

      {clicksNow == null ? (
        <p className="mt-4 text-sm text-slate-400">No Google data yet. Link Search Console in the client&apos;s settings.</p>
      ) : (
        <>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-slate-500">Visits from Google</div>
              <div className="leading-none"><b className="num text-3xl font-semibold text-slate-900">{fmt(clicksNow)}</b> <span className="text-sm text-slate-500">a week</span></div>
            </div>
            {pct != null && (
              <span data-why className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${chip}`}>
                {flat ? "No real change" : `${up ? "▲ Up" : "▼ Down"} ${Math.abs(pct)}%`}
              </span>
            )}
          </div>
          {clicksBefore != null && <p className="mt-1 text-xs text-slate-500">{fmt(clicksBefore)} a week 3 months ago</p>}
          <div className="mt-3"><Spark values={c.trend} up={up || flat} /></div>
          <div className="mt-1 flex justify-between text-[10.5px] text-slate-400"><span>12 weeks ago</span><span>last week</span></div>
          {posNow != null && (
            <p className="mt-2.5 text-xs text-slate-600">
              Usually ranks around <b className="num text-slate-900">#{Math.round(posNow)}</b> on Google
              {posBetter != null && <span className={posBetter ? " text-emerald-600" : " text-red-600"}> ({posBetter ? "better" : "worse"} than #{Math.round(posBefore!)})</span>}
            </p>
          )}
        </>
      )}

      <div className="mt-3 flex justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
        <span>{c.waiting ? <span className="font-medium text-indigo-600">{c.waiting} waiting for your review</span> : "Next blog post"}</span>
        <span className="truncate">{c.next}</span>
      </div>
    </Link>
    {c.why && <Why c={c} pct={pct} />}
    </div>
  );
}

const fmt = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString();

/** Short hover card: the 3 key numbers, the biggest page change, and the top thing to do. */
function Why({ c, pct }: { c: Pulse; pct: number | null }) {
  const w = c.why!;
  const tone = (b: boolean | null) => (b == null ? "text-slate-700" : b ? "text-emerald-600" : "text-red-600");
  const rows = w.metrics.filter((m) => m.label !== "Click rate").map((m) => ({ ...m, label: m.label === "Clicks a week" ? "Visits from Google" : m.label === "Google views a week" ? "Times shown on Google" : "Google position" }));
  const page = w.movers[0];
  const tip = w.advice[0];
  return (
    <div className="pointer-events-none invisible absolute top-[calc(100%-10px)] right-2 left-2 z-30 translate-y-2 rounded-xl border border-slate-200 bg-white p-4 opacity-0 shadow-[var(--shadow-pop)] transition-all duration-200 group-hover/why:pointer-events-auto group-hover/why:visible group-hover/why:translate-y-0 group-hover/why:opacity-100">
      <div className="text-sm font-semibold">{pct == null ? "What changed" : Math.abs(pct) < 5 ? "Visits about the same" : <>Visits {pct >= 0 ? "up" : "down"} <span className={pct >= 0 ? "text-emerald-600" : "text-red-600"}>{Math.abs(pct)}%</span></>}</div>
      <p className="text-[11px] text-slate-400">Weekly average, 3 months ago → last 4 weeks (Search Console)</p>
      <table className="mt-2 w-full text-xs">
        <tbody>
          {rows.map((m) => (
            <tr key={m.label}>
              <td className="py-0.5 text-slate-500">{m.label}</td>
              <td className="num py-0.5 text-right text-slate-500">{m.before}</td>
              <td className="px-1.5 py-0.5 text-center text-slate-300">→</td>
              <td className={`num py-0.5 text-right font-semibold ${tone(m.better)}`}>{m.now}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {page && (
        <p className="mt-2.5 border-t border-slate-100 pt-2 text-xs text-slate-600">
          Biggest change: <span className="font-medium text-slate-800">{page.label}</span>{" "}
          <span className={`num font-semibold ${page.now > page.before ? "text-emerald-600" : "text-red-600"}`}>{fmt(page.before)} → {fmt(page.now)} visits a week</span>
        </p>
      )}
      {tip && (
        <div className="mt-2.5 rounded-lg bg-indigo-50/70 p-2.5 text-xs">
          <div className="font-semibold text-slate-800">{tip.evidence}</div>
          <Link href={tip.href} className="mt-0.5 block font-medium text-indigo-600 hover:underline">→ {tip.fix}</Link>
        </div>
      )}
    </div>
  );
}
