"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

export type SideTab = { id: string; label: string; icon: IconName; intro: string; badge?: string | number | null; tone?: "good" | "warn" | "bad"; anchors?: string[]; content: ReactNode };

const TONE = { good: "bg-emerald-50 text-emerald-700", warn: "bg-amber-50 text-amber-700", bad: "bg-red-50 text-red-700" };

/** The article page's right column, split into a few clear tabs instead of one long stack of cards. */
export function SideTabs({ tabs, initial }: { tabs: SideTab[]; initial?: string }) {
  const [on, setOn] = useState(initial ?? tabs[0].id);

  // Links like #sop or #sources (from the chips above the article) open the tab that holds them.
  useEffect(() => {
    const go = () => {
      const h = window.location.hash.slice(1);
      if (!h) return;
      const t = tabs.find((x) => x.id === h || x.anchors?.includes(h));
      if (!t) return;
      setOn(t.id);
      requestAnimationFrame(() => document.getElementById(h)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [tabs]);

  const cur = tabs.find((t) => t.id === on) ?? tabs[0];
  return (
    <div className="space-y-4">
      <div role="tablist" className="sticky top-16 z-10 grid gap-1 rounded-2xl border border-slate-200 bg-white/90 p-1 shadow-sm backdrop-blur" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => {
          const active = t.id === cur.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => { setOn(t.id); history.replaceState(null, "", `#${t.id}`); }}
              className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-xs font-medium transition ${active ? "bg-indigo-600 text-white shadow" : "text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"}`}
            >
              <span className="flex items-center gap-1.5">
                <Icon name={t.icon} className="h-4 w-4" />
                {t.label}
              </span>
              {t.badge != null && t.badge !== "" && (
                <span className={`num rounded-full px-1.5 text-[10px] leading-4 ${active ? "bg-white/25 text-white" : t.tone ? TONE[t.tone] : "bg-slate-100 text-slate-600"}`}>{t.badge}</span>
              )}
            </button>
          );
        })}
      </div>
      <p className="px-1 text-xs text-slate-500">{cur.intro}</p>
      <div key={cur.id} className="page-enter space-y-6">{cur.content}</div>
    </div>
  );
}
