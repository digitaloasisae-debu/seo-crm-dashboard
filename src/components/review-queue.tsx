"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { reviewQueueAction, type QueueDecision, type QueueKind } from "@/app/actions";
import { Icon } from "./icons";
import { Kbd, toast } from "./shell";
import { burst } from "./celebrate";

export type QueueItem = {
  kind: QueueKind;
  id: string;
  clientName: string;
  title: string;
  note?: string;
  /** The customer's words (a review), shown as a quote. */
  quote?: string;
  /** The AI draft to approve (a reply or a post). */
  body?: string;
  facts: { label: string; value: string }[];
  href: string;
};

const KIND_LABEL: Record<QueueKind, string> = { keyword: "Keyword", topic: "Topic", article: "Article", review: "Review reply", post: "Google post" };
const KIND_PLURAL: Record<QueueKind, string> = { keyword: "Keywords", topic: "Topics", article: "Articles", review: "Review replies", post: "Google posts" };
const KIND_ICON: Record<QueueKind, string> = { keyword: "tag", topic: "lightbulb", article: "file", review: "star", post: "pin" };
type Out = "approve" | "reject" | "skip";

/** Big "review queue" card on Today; opens a full-screen, keyboard-driven card stack. */
export function ReviewQueue({ items, counts, streak }: { items: QueueItem[]; counts: Record<QueueKind, number>; streak: number }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const params = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Which kind the overlay shows: null = everything.
  const [only, setOnly] = useState<QueueKind | null>(null);
  const shown = only ? items.filter((it) => it.kind === only) : items;

  useEffect(() => {
    if (params.get("review") === "1" && items.length) {
      setOpen(true);
      router.replace(path, { scroll: false });
    }
  }, [params, items.length, path, router]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName);
      if (!typing && !open && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "r" && items.length) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items.length]);

  const mins = Math.max(1, Math.round(counts.keyword * 0.15 + counts.topic * 0.3 + counts.article * 2 + counts.review * 0.3 + counts.post * 0.5));
  return (
    <>
      <div className="card flex flex-col !p-0 lg:col-span-2">
        <div className="flex flex-wrap items-end justify-between gap-4 p-5 pb-4">
          <div>
            <div className="text-sm text-slate-500">Your review queue</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="num text-4xl font-semibold tracking-tight">{total}</span>
              <span className="text-sm text-slate-500">{total ? `waiting · about ${mins} min` : "nothing waiting"}</span>
            </div>
          </div>
          <button type="button" disabled={!items.length} onClick={() => { setOnly(null); setOpen(true); }} className="btn-primary" data-tip={items.length ? "Approve or reject one by one with your keyboard" : undefined}>
            {items.length ? "Start reviewing" : "All clear"}
            {items.length > 0 && <kbd className="rounded border border-white/25 px-1 font-mono text-[11px] leading-4 opacity-80">R</kbd>}
          </button>
        </div>
        <ul className="grid auto-rows-min border-t border-slate-100 sm:grid-cols-2">
          {(Object.keys(KIND_LABEL) as QueueKind[]).map((k, i) => {
            const n = counts[k];
            const has = items.some((it) => it.kind === k);
            return (
              <li key={k} className={`border-slate-100 ${i % 2 === 0 ? "sm:border-r" : ""} border-b`}>
                <button
                  type="button"
                  disabled={!has}
                  onClick={() => { setOnly(k); setOpen(true); }}
                  className="group flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left text-sm transition-colors hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className={`grid h-7 w-7 place-items-center rounded-md ${n ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-300"}`}><Icon name={KIND_ICON[k]} className="h-3.5 w-3.5" /></span>
                  <span className={`flex-1 ${n ? "text-slate-800" : "text-slate-400"}`}>{KIND_PLURAL[k]}</span>
                  <span className={`num font-medium ${n ? "text-slate-900" : "text-slate-300"}`}>{n}</span>
                  <Icon name="arrow" className={`h-3.5 w-3.5 transition ${has ? "text-slate-300 group-hover:translate-x-0.5 group-hover:text-slate-700" : "opacity-0"}`} />
                </button>
              </li>
            );
          })}
          <li className="flex items-center gap-3 border-b border-slate-100 px-5 py-3 text-sm text-slate-500">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-slate-50 text-slate-400"><Icon name="flag" className="h-3.5 w-3.5" /></span>
            <span className="flex-1">Review streak</span>
            <span className="num font-medium text-slate-900">{streak} day{streak === 1 ? "" : "s"}</span>
          </li>
        </ul>
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-xs text-slate-500">
          <span>Shortcuts in the queue:</span>
          <span><span className="kbd">A</span> approve</span>
          <span><span className="kbd">X</span> reject</span>
          <span><span className="kbd">S</span> skip</span>
          <span><span className="kbd">Esc</span> close</span>
        </div>
      </div>
      {open && createPortal(<ReviewOverlay items={shown} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function ReviewOverlay({ items, onClose }: { items: QueueItem[]; onClose: () => void }) {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [out, setOut] = useState<Out | null>(null);
  const [approved, setApproved] = useState(0);
  const [, start] = useTransition();
  const busy = useRef(false);
  const done = i >= items.length;
  const cur = items[i];

  const close = useCallback(() => {
    onClose();
    router.refresh();
  }, [onClose, router]);

  const decide = useCallback(
    (d: Out) => {
      if (busy.current || done || !cur) return;
      if (d === "reject" && cur.kind === "article") {
        toast("To request changes on an article, open it and add a note.", { tone: "err" });
        return;
      }
      busy.current = true;
      setOut(d);
      const idx = i;
      if (d === "approve") setApproved((n) => n + 1);
      if (d !== "skip") {
        const decision: QueueDecision = d;
        start(async () => {
          const r = await reviewQueueAction(cur.kind, cur.id, decision);
          if (!r.ok) {
            toast(r.error ?? "That didn't save. Try again.", { tone: "err" });
            setI(idx);
            if (d === "approve") setApproved((n) => n - 1);
            return;
          }
          toast(d === "approve" ? `Approved "${cur.title.slice(0, 42)}${cur.title.length > 42 ? "…" : ""}"` : `Rejected "${cur.title.slice(0, 42)}${cur.title.length > 42 ? "…" : ""}"`, {
            undo: () => {
              start(async () => {
                await reviewQueueAction(cur.kind, cur.id, "undo");
              });
              if (d === "approve") setApproved((n) => n - 1);
              setOut(null);
              setI(idx);
            },
          });
        });
      }
      setTimeout(
        () => {
          setI(idx + 1);
          setOut(null);
          busy.current = false;
        },
        matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 360,
      );
    },
    [cur, done, i],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "escape") close();
      else if (k === "a" || k === "arrowright") decide("approve");
      else if (k === "x" || k === "arrowleft") decide("reject");
      else if (k === "s" || k === "arrowdown") decide("skip");
      else if (k === "o" && cur) window.open(cur.href, "_blank");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [decide, close, cur]);

  const ringRef = useRef<SVGCircleElement>(null);
  useEffect(() => {
    if (!done) return;
    requestAnimationFrame(() => requestAnimationFrame(() => ringRef.current && (ringRef.current.style.strokeDashoffset = "0")));
    if (approved > 0) burst(innerWidth / 2, innerHeight / 2 - 40, 90);
  }, [done, approved]);

  return (
    <div className="fixed inset-0 z-[60] grid animate-fade-in place-items-center bg-slate-50/85 px-4 py-6 backdrop-blur-xl" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-full max-w-xl">
        <div className="mb-4 h-1 overflow-hidden rounded-full bg-slate-200">
          <i className="block h-full rounded-full bg-indigo-600 transition-[width] duration-500" style={{ width: `${(Math.min(i, items.length) / items.length) * 100}%` }} />
        </div>
        <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
          <span className="num">{done ? "Done" : `${i + 1} of ${items.length}`}</span>
          <button type="button" onClick={close} className="flex cursor-pointer items-center gap-1.5 hover:text-slate-900">
            <Kbd>Esc</Kbd> close
          </button>
        </div>

        <div className="relative h-[22rem]">
          {done ? (
            <div className="card rf-card absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
              <svg width="92" height="92" viewBox="0 0 92 92" className="mb-4" aria-hidden>
                <circle cx="46" cy="46" r="40" fill="none" stroke="var(--color-emerald-100)" strokeWidth="8" />
                <circle ref={ringRef} cx="46" cy="46" r="40" fill="none" stroke="var(--color-emerald-500)" strokeWidth="8" strokeLinecap="round" strokeDasharray="251" strokeDashoffset="251" transform="rotate(-90 46 46)" style={{ transition: "stroke-dashoffset .9s var(--ease-out-soft)" }} />
                <path d="M30 47l11 10 21-22" fill="none" stroke="var(--color-emerald-500)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h3 className="font-display text-2xl font-semibold">Queue cleared</h3>
              <p className="mt-1 mb-5 text-sm text-slate-500">{approved} approved. n8n picks up approved keywords and topics on its next run, and approved Google replies and posts wait on the Google profile tab.</p>
              <button type="button" className="btn-primary" onClick={close}>Back to Today</button>
            </div>
          ) : (
            <>
              {items[i + 1] && <QueueCard item={items[i + 1]} className="behind" />}
              <QueueCard key={cur.id} item={cur} className={out ? `out-${out}` : ""} front />
            </>
          )}
        </div>

        {!done && (
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <button type="button" onClick={() => decide("reject")} disabled={cur.kind === "article"} className="btn-secondary min-w-32 hover:border-red-200 hover:text-red-600">
              Reject <Kbd>X</Kbd>
            </button>
            <button type="button" onClick={() => decide("skip")} className="btn-secondary min-w-32">
              Skip <Kbd>S</Kbd>
            </button>
            <button type="button" onClick={() => decide("approve")} className="btn-primary min-w-32">
              Approve <kbd className="rounded-md border border-white/30 px-1.5 font-mono text-[11px]">A</kbd>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function QueueCard({ item, className, front }: { item: QueueItem; className: string; front?: boolean }) {
  return (
    <div className={`card rf-card absolute inset-0 flex flex-col gap-3 p-7 ${className}`} aria-hidden={!front}>
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
        <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-indigo-700">{KIND_LABEL[item.kind]}</span>
        <span className="text-slate-500">{item.clientName}</span>
        <Link href={item.href} target="_blank" className="ml-auto flex items-center gap-1 text-slate-400 hover:text-indigo-600" tabIndex={front ? 0 : -1}>
          Open <Icon name="external" className="h-3.5 w-3.5" />
        </Link>
      </div>
      <h3 className={`font-display leading-tight font-semibold text-balance ${item.body ? "text-lg" : "text-2xl"}`}>{item.title}</h3>
      {item.quote && <p className="line-clamp-3 border-l-2 border-slate-200 pl-3 text-sm text-slate-500 italic">{item.quote}</p>}
      {item.body && <p className="line-clamp-6 rounded-xl bg-indigo-50 px-3.5 py-3 text-sm leading-relaxed text-slate-800">{item.body}</p>}
      {item.note && <p className="line-clamp-3 text-sm text-slate-500">{item.note}</p>}
      {item.facts.length > 0 && (
        <div className="mt-auto grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {item.facts.map((f) => (
            <div key={f.label} className="rounded-xl bg-slate-100 px-3 py-2.5 text-xs text-slate-500">
              {f.label}
              <b className={`${/^[\d.,—\s]+$/.test(f.value) ? "num" : ""} mt-0.5 block truncate text-base font-medium text-slate-900`} title={f.value}>{f.value}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
