"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

export type NavItem = { href: string; label: string; icon: IconName; group?: string };

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
            {header && <div className="mt-4 mb-1 hidden px-3 text-[10px] font-semibold tracking-widest text-indigo-200/50 uppercase md:block">{header}</div>}
            <Link
              href={n.href}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm whitespace-nowrap transition-all duration-200 ${
                on ? "bg-white/10 font-medium text-white shadow-inner shadow-white/5" : "text-indigo-100/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span
                className={`absolute top-1/2 left-0 hidden h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-indigo-300 to-fuchsia-400 transition-all duration-300 md:block ${
                  on ? "opacity-100" : "scale-y-0 opacity-0"
                }`}
              />
              <Icon name={n.icon} className={`h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110 ${on ? "text-indigo-300" : ""}`} />
              {n.label}
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
    <nav className="mb-6 flex w-full gap-1 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/70 p-1 shadow-sm backdrop-blur md:w-fit">
      {items.map((t, i) => {
        const on = active(t.href, i);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm whitespace-nowrap transition-all duration-200 ${
              on ? "bg-gradient-to-b from-indigo-500 to-indigo-600 font-medium text-white shadow-md shadow-indigo-500/25" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {t.icon && <Icon name={t.icon} className="h-3.5 w-3.5" />}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
