"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

export type NavItem = { href: string; label: string; icon: IconName; group?: string; badge?: number };

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  let lastGroup: string | undefined;
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
      {items.map((n) => {
        const header = n.group && n.group !== lastGroup ? n.group : null;
        lastGroup = n.group;
        const on = active(n.href);
        return (
          <div key={n.href} className="contents">
            {header && <div className="rf-side-muted mt-5 mb-1 hidden px-2.5 text-[11px] font-semibold tracking-wide md:block">{header}</div>}
            <Link
              href={n.href}
              aria-current={on ? "page" : undefined}
              className={`rf-side-link relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm whitespace-nowrap transition-colors duration-100 ${on ? "font-medium" : ""}`}
            >
              {on && <span className="absolute top-2 bottom-2 -left-3 hidden w-[3px] rounded-r bg-[#f5b83d] md:block" />}
              <Icon name={n.icon} className="rf-side-icon h-4 w-4 shrink-0" />
              {n.label}
              {!!n.badge && <span className="rf-side-badge num ml-auto rounded-md px-1.5 text-[11px] leading-5">{n.badge}</span>}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

export function Tabs({ items }: { items: { href: string; label: string; icon?: IconName }[] }) {
  const path = usePathname();
  // Exact match for the first (overview) tab, prefix match for the rest.
  const active = (href: string, i: number) => (i === 0 ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <nav className="mb-6 flex w-full gap-5 overflow-x-auto border-b border-slate-200">
      {items.map((t, i) => {
        const on = active(t.href, i);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`group relative -mb-px flex items-center gap-1.5 border-b-2 px-1 py-2.5 text-sm whitespace-nowrap transition-colors duration-100 ${
              on ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900"
            }`}
          >
            {t.icon && <Icon name={t.icon} className={`h-3.5 w-3.5 ${on ? "" : "text-slate-400 group-hover:text-slate-600"}`} />}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export type GroupTone = "indigo" | "emerald" | "amber" | "slate";
export type GroupedNav = { label: string; tone: GroupTone; icon: IconName; items: { href: string; label: string; icon: IconName; tip: string }[] }[];

const TONE: Record<GroupTone, { head: string; dot: string; on: string; icon: string }> = {
  indigo: { head: "text-indigo-700", dot: "bg-indigo-500", on: "bg-indigo-50 text-indigo-800 ring-indigo-200", icon: "text-indigo-500" },
  emerald: { head: "text-emerald-700", dot: "bg-emerald-500", on: "bg-emerald-50 text-emerald-800 ring-emerald-200", icon: "text-emerald-600" },
  amber: { head: "text-amber-700", dot: "bg-amber-500", on: "bg-amber-50 text-amber-800 ring-amber-200", icon: "text-amber-600" },
  slate: { head: "text-slate-600", dot: "bg-slate-400", on: "bg-slate-100 text-slate-900 ring-slate-300", icon: "text-slate-500" },
};

/** Every client page at a glance: four labelled groups, nothing hidden behind a scroll. */
export function ClientNav({ groups }: { groups: GroupedNav }) {
  const path = usePathname();
  const first = groups[0]?.items[0]?.href;
  const isOn = (href: string) => (href === first ? path === href : path === href || path.startsWith(`${href}/`));
  const current = groups.flatMap((g) => g.items.map((i) => ({ ...i, g }))).find((i) => isOn(i.href));
  return (
    <div className="mb-6">
      <nav className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-card)] lg:grid-cols-[1fr_1fr_1.35fr_1fr] lg:divide-x lg:divide-slate-100 lg:p-0">
        {groups.map((g) => {
          const t = TONE[g.tone];
          return (
            <div key={g.label} className="min-w-0 lg:px-4 lg:py-3.5">
              <div className={`mb-2 flex items-center gap-1.5 text-xs font-semibold ${t.head}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
                {g.label}
              </div>
              <div className="flex flex-wrap gap-1">
                {g.items.map((i) => {
                  const on = isOn(i.href);
                  return (
                    <Link
                      key={i.href}
                      href={i.href}
                      aria-current={on ? "page" : undefined}
                      data-tip={i.tip}
                      data-tip-pos="bottom"
                      className={`group inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] whitespace-nowrap transition-colors duration-100 ${
                        on ? `font-medium ring-1 ${t.on}` : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      <Icon name={i.icon} className={`h-3.5 w-3.5 shrink-0 ${on ? "" : `${t.icon} opacity-70 group-hover:opacity-100`}`} />
                      {i.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      {current && (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <span className={`h-1.5 w-1.5 rounded-full ${TONE[current.g.tone].dot}`} />
          <span className="font-medium text-slate-800">{current.label}</span>
          <span className="text-slate-300">·</span>
          {current.tip}
        </p>
      )}
    </div>
  );
}
