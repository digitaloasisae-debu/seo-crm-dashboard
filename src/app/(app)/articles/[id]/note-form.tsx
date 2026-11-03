"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { Spinner } from "@/components/spinner";

const KINDS = [
  { v: "GENERAL", l: "💬 General" },
  { v: "CONTENT", l: "✍️ Content" },
  { v: "TITLE", l: "🏷️ Title" },
  { v: "IMAGE", l: "🖼️ Image" },
];

export function NoteForm({ action }: { action: (prev: string | null, fd: FormData) => Promise<string | null> }) {
  const [error, run, pending] = useActionState(action, null);
  const [kind, setKind] = useState("GENERAL");
  const form = useRef<HTMLFormElement>(null);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !pending && !error) form.current?.reset();
    was.current = pending;
  }, [pending, error]);
  return (
    <form ref={form} action={run} className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <label key={k.v} className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition select-none ${kind === k.v ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"}`}>
            <input type="radio" name="kind" value={k.v} checked={kind === k.v} onChange={() => setKind(k.v)} className="sr-only" />
            {k.l}
          </label>
        ))}
      </div>
      <input className="input" name="quote" placeholder={kind === "IMAGE" ? "Which image? (optional)" : "Which part? Paste the sentence (optional)"} />
      <textarea
        className="input"
        name="body"
        rows={3}
        required
        placeholder={kind === "IMAGE" ? "e.g. Use a real photo of a Dubai villa instead of an illustration" : kind === "TITLE" ? "e.g. Titles are too long, give me punchier options" : "e.g. Intro is too salesy. Start with the customer's problem."}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">🧠 Every note teaches this client&apos;s brain, so the next blogs get it right.</p>
        <button className="btn-primary shrink-0" disabled={pending}>{pending ? <><Spinner /> Saving…</> : "Add note"}</button>
      </div>
    </form>
  );
}
