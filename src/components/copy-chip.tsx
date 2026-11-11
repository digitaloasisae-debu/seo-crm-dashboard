"use client";

import { useState } from "react";
import { Icon } from "./icons";
import { toast } from "./shell";

/** Click to copy a value (keyword, slug, title…), with a quick tick so you know it worked. */
export function CopyChip({ text, label, className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Click to copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          toast(`Copied ${label ?? "to clipboard"}`);
          setTimeout(() => setDone(false), 1400);
        } catch {
          toast("Couldn't copy. Select the text instead.", { tone: "err" });
        }
      }}
      className={`group inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left transition hover:bg-slate-100 active:scale-[0.98] ${className}`}
    >
      <span className="min-w-0 break-words">{text}</span>
      <Icon name={done ? "check" : "copy"} className={`h-3.5 w-3.5 shrink-0 transition ${done ? "text-emerald-600" : "text-slate-300 group-hover:text-slate-500"}`} />
    </button>
  );
}
