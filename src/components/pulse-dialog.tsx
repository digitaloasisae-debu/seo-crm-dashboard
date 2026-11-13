"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { PulseWhy } from "@/lib/pulse-reasons";
import { Icon } from "@/components/icons";

type Labels = { prev: string; now: string; chartFrom: string; chartTo: string };
const fmt = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString();
const NAMES: Record<string, [string, string]> = {
  "Clicks a week": ["Visits from Google", "People who clicked through to the site, per week"],
  "Google views a week": ["Times shown on Google", "How often the site appeared in search results, per week"],
  "Average position": ["Average Google position", "Lower is better. #1 is the top result"],
  "Click rate": ["Click rate", "Visits ÷ times shown"],
};

/** "See details" button on a Today client card: opens a popup with all the numbers, what changed and what to do. */
export function PulseDialog({ clientId, name, site, why, labels }: { clientId: string; name: string; site: string; why: PulseWhy; labels: Labels }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);
  const c = `/clients/${clientId}`;
  const origin = site.replace(/\/+$/, "");
  const pct = why.pct;
  const tone = (b: boolean | null) => (b == null ? "text-slate-800" : b ? "text-emerald-600" : "text-red-600");
  const Change = ({ before, now }: { before: number; now: number }) => <span className={`num font-semibold ${now > before ? "text-emerald-600" : now < before ? "text-red-600" : "text-slate-700"}`}>{fmt(before)} → {fmt(now)}</span>;
  const links: [string, string, string][] = [
    ["Client overview", c, "briefcase"],
    ["Keyword tracking", `${c}/rankings`, "trending"],
    ["Traffic recovery", `${c}/refresh`, "refresh"],
    ["SEO audit", `${c}/seo`, "chart"],
    ["Topics", `${c}/topics`, "lightbulb"],
  ];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-1.5 rounded-b-[inherit] border-t border-slate-100 py-2.5 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50">
        See details and what to do <Icon name="arrow" className="h-3.5 w-3.5" />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[rgb(15_23_42/.45)] p-4 backdrop-blur-[2px] md:items-center" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={`${name} details`} onClick={(e) => e.stopPropagation()} className="rf-pop relative my-6 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-pop)]">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <div className="text-xs font-medium text-slate-500">{name}</div>
                <h2 className="mt-0.5 text-lg font-semibold">
                  {pct == null ? "Google visits" : Math.abs(pct) < 5 ? "Visits from Google are about the same" : <>Visits from Google are {pct >= 0 ? "up" : "down"} <span className={pct >= 0 ? "text-emerald-600" : "text-red-600"}>{Math.abs(pct)}%</span></>}
                </h2>
                <p className="text-xs text-slate-500">Last 4 weeks ({labels.now}) compared with the month before ({labels.prev}). Source: Google Search Console.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><Icon name="x" className="h-4 w-4" /></button>
            </div>

            <div className="space-y-5 p-5">
              <section>
                <h3 className="mb-2 text-sm font-semibold">The numbers</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {why.metrics.map((m) => (
                    <div key={m.label} className="rounded-xl border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">{NAMES[m.label]?.[0] ?? m.label}</div>
                      <div className="mt-0.5 text-sm"><span className="num text-slate-500">{m.before}</span> <span className="text-slate-300">→</span> <span className={`num text-lg font-semibold ${tone(m.better)}`}>{m.now}</span></div>
                      <div className="text-[11px] text-slate-400">{NAMES[m.label]?.[1]}</div>
                    </div>
                  ))}
                </div>
              </section>

              {why.advice.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">What to do</h3>
                  <ol className="space-y-2">
                    {why.advice.map((a, i) => (
                      <li key={i} className="rounded-xl bg-indigo-50/60 p-3 text-sm">
                        <div className="font-semibold text-slate-900">{i + 1}. {a.fix}</div>
                        <div className="mt-0.5 text-xs text-slate-600"><b className="font-medium">Why:</b> {a.evidence}. {a.reason}</div>
                        <Link href={a.href} onClick={() => setOpen(false)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline">Open the page to fix it <Icon name="arrow" className="h-3 w-3" /></Link>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {why.movers.length > 0 && (
                <section>
                  <h3 className="mb-1 text-sm font-semibold">Pages that changed most</h3>
                  <p className="mb-2 text-xs text-slate-500">Visits a week, month before → last 4 weeks</p>
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {why.movers.map((m) => (
                      <li key={m.label} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <a href={m.label === "Home page" ? origin : `${origin}${m.label}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-indigo-600 hover:underline">{m.label}</a>
                        <Change before={m.before} now={m.now} />
                        {m.posBefore != null && m.posNow != null && <span className="num w-24 shrink-0 text-right text-xs text-slate-500">#{Math.round(m.posBefore)} → #{Math.round(m.posNow)}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {why.searches.length > 0 && (
                <section>
                  <h3 className="mb-1 text-sm font-semibold">Searches that changed most</h3>
                  <p className="mb-2 text-xs text-slate-500">What people typed on Google. Visits a week, month before → last 4 weeks</p>
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {why.searches.map((m) => (
                      <li key={m.label} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{m.label}</span>
                        <Change before={m.before} now={m.now} />
                        {m.posBefore != null && m.posNow != null && <span className="num w-24 shrink-0 text-right text-xs text-slate-500">#{Math.round(m.posBefore)} → #{Math.round(m.posNow)}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {why.facts.length > 0 && <ul className="space-y-0.5 text-xs text-slate-500">{why.facts.map((f) => <li key={f}>• {f}</li>)}</ul>}

              <section className="border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-sm font-semibold">Go to</h3>
                <div className="flex flex-wrap gap-2">
                  {links.map(([label, href, icon]) => (
                    <Link key={href} href={href} onClick={() => setOpen(false)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"><Icon name={icon as never} className="h-3.5 w-3.5" /> {label}</Link>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
