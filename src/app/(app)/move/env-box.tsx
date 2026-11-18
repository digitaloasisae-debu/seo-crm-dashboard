"use client";

import { useState } from "react";

export function EnvBox({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); } catch { setShow(true); } }}>
          {done ? "Copied" : "Copy all settings"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>
      </div>
      {show && <textarea readOnly className="input font-mono text-xs" rows={20} value={text} onFocus={(e) => e.currentTarget.select()} />}
      <p className="text-xs text-slate-500">{text.trim().split("\n").length} settings. AUTH_SECRET and CRON_SECRET are left out on purpose, because the VPS file already has new ones.</p>
    </section>
  );
}
