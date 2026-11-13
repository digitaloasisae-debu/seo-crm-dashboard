"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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

export type GroupTone = "indigo" | "emerald" | "amber" | "violet";
export type GroupedNav = { label: string; tone: GroupTone; icon: IconName; blurb: string; items: { href: string; label: string; icon: IconName; tip: string; badge?: number }[] }[];

/** Design B: four big group tabs; the open group's pages sit right underneath as pills. */
export function ClientTabs({ groups }: { groups: GroupedNav }) {
  const path = usePathname();
  const first = groups[0]?.items[0]?.href;
  const isOn = (href: string) => (href === first ? path === href : path === href || path.startsWith(`${href}/`));
  const current = groups.findIndex((g) => g.items.some((i) => isOn(i.href)));
  const [open, setOpen] = useState(current < 0 ? 0 : current);
  useEffect(() => { if (current >= 0) setOpen(current); }, [current]);
  const g = groups[open];
  const page = groups.flatMap((x) => x.items).find((i) => isOn(i.href));
  return (
    <div className="mb-7 print:hidden">
      <div role="tablist" className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {groups.map((x, i) => {
          const on = i === open;
          const waiting = x.items.reduce((a, it) => a + (it.badge ?? 0), 0);
          return (
            <button
              key={x.label}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setOpen(i)}
              className={`rf-gtab rf-tone-${x.tone} group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-2xl border p-3 text-left transition-all duration-300 sm:p-3.5 ${on ? "is-on" : ""}`}
            >
              <span className="rf-gtab-icon relative grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                <Icon name={x.icon} className="h-5 w-5" />
              </span>
              <span className="relative min-w-0 flex-1">
                <span className="block text-[15px] font-semibold leading-tight">{x.label}</span>
                <span className="rf-gtab-sub block truncate text-xs">{x.blurb}</span>
              </span>
              {waiting > 0 && <span className="rf-gtab-badge relative num rounded-full px-2 text-[11px] leading-5 font-semibold">{waiting}</span>}
            </button>
          );
        })}
      </div>
      <div key={open} className={`rf-tone-${g.tone} rf-pages mt-3 flex flex-wrap items-center gap-2`}>
        {g.items.map((it, k) => {
          const on = isOn(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              data-tip={it.tip}
              data-tip-pos="bottom"
              aria-current={on ? "page" : undefined}
              style={{ animationDelay: `${k * 45}ms` }}
              className={`rf-pill group inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-all duration-200 ${on ? "is-on" : ""}`}
            >
              <Icon name={it.icon} className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-125" />
              {it.label}
              {!!it.badge && <span className="rf-pill-badge num rounded-full px-1.5 text-[10.5px] leading-[18px] font-semibold">{it.badge}</span>}
            </Link>
          );
        })}
      </div>
      {page && <p key={page.href} className="animate-fade-in mt-3 text-sm text-slate-500"><span className="font-medium text-slate-800">{page.label}:</span> {page.tip}.</p>}
    </div>
  );
}
