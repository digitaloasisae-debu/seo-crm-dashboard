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
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${tone[color ?? "gray"]}`}>
      <span className="relative flex h-1.5 w-1.5">
        {pulse && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--dot)] opacity-75" />}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--dot)]" />
      </span>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge color={statusTone[status] ?? "gray"} pulse={pulsing.has(status)}>{status.replace(/_/g, " ").toLowerCase()}</Badge>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="bg-gradient-to-r from-slate-900 via-indigo-900 to-violet-800 bg-clip-text text-2xl font-bold tracking-tight text-transparent md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/50 p-10 text-center text-sm text-slate-500">
      <span className="bob flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-100 text-indigo-500">
        <Icon name="sparkles" className="h-5 w-5" />
      </span>
      <div>{children}</div>
    </div>
  );
}

export function Stat({ label, value, href, icon, alert }: { label: string; value: number; href?: string; icon?: IconName; alert?: boolean }) {
  const hot = alert && value > 0;
  const body = (
    <div className={`card group relative h-full overflow-hidden ${hot ? "border-red-200" : ""}`}>
      <div className={`pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full blur-2xl transition-opacity duration-300 group-hover:opacity-100 ${hot ? "bg-red-400/20 opacity-70" : "bg-indigo-400/15 opacity-50"}`} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
        {icon && (
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110 group-hover:rotate-3 ${hot ? "bg-red-50 text-red-500" : "bg-indigo-50 text-indigo-500"}`}>
            <Icon name={icon} className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className={`relative mt-2 text-3xl font-bold tracking-tight tabular-nums ${hot ? "text-red-600" : value > 0 ? "text-slate-900" : "text-slate-300"}`}><CountUp value={value} /></div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
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
        <circle cx="60" cy="60" r={r} fill="none" stroke="#eef2ff" strokeWidth="10" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
          style={{ animation: "ring-draw 1.1s cubic-bezier(0.22,1,0.36,1) both", ["--ring-c" as string]: `${c}`, filter: `drop-shadow(0 0 6px ${color}55)` }}
        />
      </svg>
      <div className="absolute inset-0 flex animate-pop flex-col items-center justify-center [animation-delay:300ms]">
        <span className="leading-none font-bold tracking-tight tabular-nums" style={{ color, fontSize: Math.round(size * 0.28) }}>{score ?? "—"}{suffix}</span>
        {size >= 100 && !suffix && <span className="mt-1 text-[10px] font-semibold tracking-widest text-slate-400 uppercase">/ 100</span>}
      </div>
    </div>
  );
}
