"use client";
import { useState } from "react";
import { Spinner } from "./spinner";

/** "Email report" button with a small form: recipients + optional message. */
export function EmailReport({ crawlId, defaultTo, configured }: { crawlId: string; defaultTo: string; configured: boolean }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/audit/${crawlId}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, message }) });
      const j = await res.json().catch(() => ({}));
      setResult(res.ok ? { ok: true, text: `Sent to ${(j.to ?? []).join(", ")}` } : { ok: false, text: j.error ?? `Failed (${res.status})` });
      if (res.ok) setMessage("");
    } catch (e) {
      setResult({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={open ? "w-full" : ""}>
      {!open ? (
        <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>Email report</button>
      ) : (
        <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          {!configured && <p className="text-xs text-amber-700">Email isn&apos;t set up yet: add GMAIL_USER and GMAIL_APP_PASSWORD in Vercel.</p>}
          <label className="block text-xs font-medium text-slate-600">To (separate several with commas)
            <input className="input mt-1" type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com, owner@example.com" />
          </label>
          <label className="block text-xs font-medium text-slate-600">Message (optional)
            <textarea className="input mt-1" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hi Sam, here's this month's SEO audit. The top 3 fixes are already in progress." />
          </label>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary" disabled={busy || !to.trim() || !configured} onClick={send}>{busy ? <><Spinner className="h-4 w-4" /> Sending…</> : "Send with PDF attached"}</button>
            <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => { setOpen(false); setResult(null); }}>Close</button>
          </div>
          {result && <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.ok ? "✓ " : ""}{result.text}</p>}
        </div>
      )}
    </div>
  );
}
