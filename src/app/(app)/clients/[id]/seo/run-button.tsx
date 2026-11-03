"use client";
import { useFormStatus } from "react-dom";
import { Spinner } from "@/components/spinner";

export function RunButton({ label, pendingLabel = "Auditing…" }: { label: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-3">
      <button className="btn-primary" disabled={pending}>{pending ? <><Spinner /> {pendingLabel}</> : label}</button>
      {pending && <span className="animate-fade-in text-sm text-slate-500">This takes up to a minute. Keep this tab open.</span>}
    </div>
  );
}
