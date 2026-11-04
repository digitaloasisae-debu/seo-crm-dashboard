"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/spinner";
import type { TitleState } from "../../../actions";

/** Ask the AI to rewrite the article with the team's changes. */
export function RewriteForm({ action, pendingNotes }: { action: (prev: string | null, fd: FormData) => Promise<string | null>; pendingNotes: number }) {
  const [error, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="space-y-3">
      <textarea
        className="input"
        name="instructions"
        rows={3}
        placeholder="e.g. Make the intro shorter, add a section on costs in Dubai, and use a friendlier tone"
      />
      {pendingNotes > 0 && (
        <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          📝 {pendingNotes} note{pendingNotes === 1 ? "" : "s"} on this article will be applied too.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? <><Spinner /> Starting…</> : "✨ Rewrite article"}
      </button>
    </form>
  );
}

/** Refreshes the page every few seconds while a rewrite runs in the background. */
export function RefreshWhile({ ms = 5000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}

/** "Give me 3 title options", then one click to use one. */
export function TitleOptions({
  action,
  apply,
}: {
  action: (prev: TitleState, fd: FormData) => Promise<TitleState>;
  apply: (title: string, description: string) => Promise<void>;
}) {
  const [state, run, pending] = useActionState(action, null);
  const [applying, startApply] = useTransition();
  const chosen = useRef<number | null>(null);
  return (
    <div className="space-y-3">
      <form action={run} className="flex gap-2">
        <input className="input" name="hint" placeholder="Optional: e.g. shorter, mention 2026, more local" />
        <button className="btn-secondary shrink-0" disabled={pending}>{pending ? <><Spinner /> Thinking…</> : state?.options ? "🔄 New options" : "🏷️ 3 title options"}</button>
      </form>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.options && (
        <ul className="stagger space-y-2">
          {state.options.map((o, i) => (
            <li key={`${o.title}-${i}`} className="rounded-xl border border-slate-200 bg-white p-3 text-sm transition hover:border-indigo-300 hover:shadow-sm">
              <div className="font-semibold text-slate-900">{o.title} <span className="font-normal text-slate-400">· {o.title.length} chars</span></div>
              {o.description && <p className="mt-1 text-slate-600">{o.description}</p>}
              <div className="mt-2 flex items-center justify-between gap-2">
                {o.why ? <span className="text-xs text-violet-700">💡 {o.why}</span> : <span />}
                <button
                  type="button"
                  className="btn-secondary px-2.5 py-1 text-xs"
                  disabled={applying}
                  onClick={() => { chosen.current = i; startApply(() => apply(o.title, o.description)); }}
                >
                  {applying && chosen.current === i ? <><Spinner className="h-3 w-3" /> Using…</> : "Use this"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
