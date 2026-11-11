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
            {header && <div className="mt-5 mb-1 hidden px-2.5 text-xs font-medium text-slate-400 md:block">{header}</div>}
            <Link
              href={n.href}
              aria-current={on ? "page" : undefined}
              className={`group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors duration-100 ${
                on ? "bg-slate-200/70 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900"
              }`}
            >
              {on && <span className="absolute top-1.5 bottom-1.5 -left-3 hidden w-[3px] rounded-r bg-indigo-600 md:block" />}
              <Icon name={n.icon} className={`h-4 w-4 shrink-0 ${on ? "text-slate-900" : "text-slate-400 group-hover:text-slate-700"}`} />
              {n.label}
              {!!n.badge && <span className={`num ml-auto rounded px-1.5 text-[11px] leading-5 ${on ? "ink" : "bg-slate-200 text-slate-700"}`}>{n.badge}</span>}
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
