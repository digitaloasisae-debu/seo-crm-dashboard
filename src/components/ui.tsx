import Link from "next/link";
import type { ReactNode } from "react";

const tone: Record<string, string> = {
  gray: "bg-slate-100 text-slate-700",
  green: "bg-emerald-100 text-emerald-800",
  yellow: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-sky-100 text-sky-800",
  indigo: "bg-indigo-100 text-indigo-800",
};

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

export function Badge({ children, color }: { children: ReactNode; color?: keyof typeof tone }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tone[color ?? "gray"]}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge color={statusTone[status] ?? "gray"}>{status.replace(/_/g, " ").toLowerCase()}</Badge>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold">{value}</div>
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
