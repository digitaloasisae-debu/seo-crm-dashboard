"use client";
import { useFormStatus } from "react-dom";

export function RunButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-3">
      <button className="btn-primary" disabled={pending}>{pending ? "Auditing…" : label}</button>
      {pending && <span className="text-sm text-slate-500">This takes up to a minute. Keep this tab open.</span>}
    </div>
  );
}
