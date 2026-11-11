import Link from "next/link";

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
  const up = lastV >= first;
  const pct = first ? Math.round((lastV / first - 1) * 100) : null;
  const tone = c.health == null ? "bg-slate-100 text-slate-500" : c.health >= 80 ? "bg-emerald-50 text-emerald-700" : c.health >= 65 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
  return (
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
        <div>12 weeks<b className={`num block text-lg font-medium ${pct == null ? "text-slate-400" : up ? "text-emerald-600" : "text-red-600"}`}>{pct == null ? "—" : `${up ? "▲" : "▼"} ${Math.abs(pct)}%`}</b></div>
      </div>
      <Spark values={c.trend} up={up} />
      <div className="mt-3 flex justify-between gap-2 text-xs text-slate-500">
        <span>{c.waiting ? <span className="font-medium text-indigo-600">{c.waiting} waiting on you</span> : "Next post"}</span>
        <span className="truncate">{c.next}</span>
      </div>
    </Link>
  );
}
