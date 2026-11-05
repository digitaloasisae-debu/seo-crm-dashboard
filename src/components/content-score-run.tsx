"use client";

import { useActionState } from "react";
import { Spinner } from "./spinner";

export function ContentScoreRun({ action, label, className = "btn-secondary w-full" }: { action: (prev: string | null) => Promise<string | null>; label: string; className?: string }) {
  const [error, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="space-y-1">
      <button className={className} disabled={pending}>{pending ? <><Spinner /> Reading Google&apos;s top 10…</> : label}</button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
