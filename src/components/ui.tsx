import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { CountUp } from "./fun";

const tone: Record<string, string> = {
  gray: "bg-slate-100 text-slate-700 ring-slate-500/15 [--dot:var(--color-slate-400)]",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 [--dot:var(--color-emerald-500)]",
  yellow: "bg-amber-50 text-amber-700 ring-amber-600/20 [--dot:var(--color-amber-500)]",
  red: "bg-red-50 text-red-700 ring-red-600/20 [--dot:var(--color-red-500)]",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20 [--dot:var(--color-sky-500)]",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20 [--dot:var(--color-indigo-500)]",
};
/** Plain-English names and hover explanations for workflow states. */
const STATUS_LABEL: Record<string, string> = { READY_FOR_REVIEW: "Ready for review", PUSHED_DRAFT: "On WordPress", PUSH_FAILED: "Push failed", CHANGES_REQUESTED: "Changes requested", GENERATED: "Needs review" };
const STATUS_TIP: Record<string, string> = {
  PENDING: "Waiting for someone to approve or reject",
  APPROVED: "Approved and ready for the next step",
  REJECTED: "Rejected, it will not be used",
  GENERATED: "Written by Rankflow, waiting for review",
  GENERATING: "Rankflow is writing this now",
  READY_FOR_REVIEW: "Written, waiting for you to approve",
  CHANGES_REQUESTED: "Sent back for a rewrite",
  PUSHING: "Sending to WordPress",
  PUSHED_DRAFT: "Saved on the WordPress site",
  PUSH_FAILED: "WordPress refused it, open to see why",
};
const pulsing = new Set(["PUSHING", "GENERATING"]);

const statusTone: Record<string, keyof typeof tone> = {
  PENDING: "yellow",
  APPROVED: "green",
  REJECTED: "red",
  GENERATED: "yellow",
  GENERATING: "gray",
  READY_FOR_REVIEW: "yellow",
  CHANGES_REQUESTED: "red",
  PUSHING: "blue",
  PUSHED_DRAFT: "indigo",
  PUSH_FAILED: "red",
  ACTIVE: "green",
  PAUSED: "yellow",
  ARCHIVED: "gray",
  DENIED: "red",
  OWNER: "indigo",
  EDIT: "blue",
  VIEW: "gray",
};

export function Badge({ children, color, pulse }: { children: ReactNode; color?: keyof typeof tone; pulse?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${tone[color ?? "gray"]}`}>
      <span className="relative flex h-1.5 w-1.5">
        {pulse && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--dot)] opacity-75" />}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--dot)]" />
      </span>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status.replace(/_/g, " ").toLowerCase();
  return <span data-tip={STATUS_TIP[status]}><Badge color={statusTone[status] ?? "gray"} pulse={pulsing.has(status)}>{label.charAt(0).toUpperCase() + label.slice(1)}</Badge></span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">
        <Icon name={icon ?? "inbox"} className="h-4 w-4" />
      </span>
      <div>{children}</div>
    </div>
  );
}

export type PeekItem = { label: string; sub?: string; href: string };

export function Stat({ label, value, href, icon, alert, items }: { label: string; value: number; href?: string; icon?: IconName; alert?: boolean; items?: PeekItem[] }) {
  const hot = alert && value > 0;
  const body = (
    <div className={`card group relative h-full !p-4 ${hot ? "border-red-200" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] text-slate-500">
          {icon && <Icon name={icon} className={`h-3.5 w-3.5 ${hot ? "text-red-500" : "text-slate-400"}`} />}
          {label}
        </div>
        {href && <Icon name="arrow" className="h-3.5 w-3.5 -translate-x-1 text-slate-300 opacity-0 transition group-hover:translate-x-0 group-hover:text-slate-500 group-hover:opacity-100" />}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tracking-tight tabular-nums ${hot ? "text-red-600" : value > 0 ? "text-slate-900" : "text-slate-300"}`}><CountUp value={value} /></div>
    </div>
  );
  const card = href ? <Link href={href} className="block h-full">{body}</Link> : body;
  if (!items) return card;
  return (
    <div className="group/peek relative h-full hover:z-40 focus-within:z-40" tabIndex={0}>
      {card}
      <div className="invisible absolute top-full right-0 left-0 z-30 mt-1.5 translate-y-1 rounded-xl border border-slate-200 bg-white p-1.5 opacity-0 shadow-[var(--shadow-pop)] transition-all duration-200 group-hover/peek:visible group-hover/peek:translate-y-0 group-hover/peek:opacity-100 group-focus-within/peek:visible group-focus-within/peek:opacity-100">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-slate-500">Nothing here. You&apos;re all clear.</p>
        ) : (
          <ul className="relative max-h-72 overflow-y-auto">
            {items.map((it, i) => (
              <li key={i}>
                <Link href={it.href} className="group/it flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition hover:bg-slate-100">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{it.label}</span>
                    {it.sub && <span className="block truncate text-xs text-slate-500">{it.sub}</span>}
                  </span>
                  <Icon name="arrow" className="h-3.5 w-3.5 text-slate-300 transition group-hover/it:translate-x-0.5 group-hover/it:text-slate-600" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

/** Circular 0–100 score that draws itself in on load. */
export function ScoreRing({ score, size = 132, color: fixed, suffix }: { score: number | null | undefined; size?: number; color?: string; suffix?: string }) {
  const v = Math.max(0, Math.min(100, score ?? 0));
  const r = 52;
  const c = 2 * Math.PI * r;
  const color = fixed ?? (score == null ? "#cbd5e1" : v >= 90 ? "#10b981" : v >= 50 ? "#f59e0b" : "#ef4444");
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-slate-100)" strokeWidth="8" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
          style={{ animation: "ring-draw 1.1s cubic-bezier(0.22,1,0.36,1) both", ["--ring-c" as string]: `${c}` }}
        />
      </svg>
      <div className="absolute inset-0 flex animate-pop flex-col items-center justify-center [animation-delay:300ms]">
        <span className="leading-none font-semibold tracking-tight tabular-nums" style={{ color, fontSize: Math.round(size * 0.28) }}>{score ?? "—"}{suffix}</span>
        {size >= 100 && !suffix && <span className="mt-1 text-[11px] text-slate-400">of 100</span>}
      </div>
    </div>
  );
}

/** A keyword that opens its live Google results in a new tab. */
export function KeywordLink({ keyword, className = "" }: { keyword: string; className?: string }) {
  return (
    <a
      href={`https://www.google.com/search?q=${encodeURIComponent(keyword)}`}
      target="_blank"
      rel="noreferrer"
      title="See who ranks on Google for this keyword"
      className={`group/kw inline-flex items-center gap-1 text-slate-800 decoration-indigo-300 decoration-2 underline-offset-4 transition-colors hover:text-indigo-700 hover:underline ${className}`}
    >
      {keyword}
      <Icon name="search" className="h-3 w-3 shrink-0 text-slate-300 transition group-hover/kw:translate-x-0.5 group-hover/kw:text-indigo-500" />
    </a>
  );
}

/** Tiny line of Google positions over time (higher on the chart = better rank). */
export function RankSparkline({ points, width = 120, height = 32 }: { points: { position: number }[]; width?: number; height?: number }) {
  if (points.length < 2) return <span className="text-xs text-slate-300">—</span>;
  const ps = points.map((p) => p.position);
  const lo = Math.min(...ps), hi = Math.max(...ps);
  const span = Math.max(hi - lo, 1);
  const x = (i: number) => 2 + (i * (width - 4)) / (ps.length - 1);
  const y = (v: number) => 3 + ((v - lo) / span) * (height - 6);
  const d = ps.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const better = ps.at(-1)! <= ps[0];
  const c = better ? "#059669" : "#dc2626";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="h-auto max-w-full" role="img" aria-label={`Position ${ps[0].toFixed(1)} to ${ps.at(-1)!.toFixed(1)}`}>
      <title>{points.map((p) => p.position.toFixed(1)).join(" → ")}</title>
      <path d={d} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(ps.length - 1)} cy={y(ps.at(-1)!)} r="2.5" fill={c} />
    </svg>
  );
}

/** ▲ 3.2 / ▼ 1.5 change in Google position (prev minus current: positive = climbed). */
export function RankChange({ position, prev }: { position: number; prev: number | null | undefined }) {
  if (prev == null) return <span className="text-xs text-slate-400">new</span>;
  const d = prev - position;
  if (Math.abs(d) < 0.5) return <span className="text-xs text-slate-400">–</span>;
  return <span className={`text-xs font-semibold ${d > 0 ? "text-emerald-600" : "text-red-600"}`}>{d > 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1)}</span>;
}
