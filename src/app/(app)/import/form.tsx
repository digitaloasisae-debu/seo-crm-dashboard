"use client";
import { useActionState } from "react";
import { importSheetAction, type ImportState } from "./actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importSheetAction, null);
  const r = state?.report;
  return (
    <div className="space-y-6">
      <form action={action} className="card space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>Add your team on the <a className="text-indigo-600 hover:underline" href="/users">Team</a> page first, so each client is assigned to the person in &quot;Submitted By&quot;.</li>
          <li>In Google Sheets: File → Download → Microsoft Excel (.xlsx).</li>
          <li>Choose the file, click <b>Preview</b>, check the numbers, then click <b>Import</b>.</li>
        </ol>
        <input type="file" name="file" accept=".xlsx" required className="block text-sm" />
        <div className="flex flex-wrap gap-2">
          <button name="mode" value="preview" className="btn-secondary" disabled={pending}>Preview</button>
          <button name="mode" value="import" className="btn-primary" disabled={pending}>Import</button>
          {pending && <span className="self-center text-sm text-slate-500">Working… this can take up to a minute.</span>}
        </div>
        <p className="text-xs text-slate-500">WordPress passwords are encrypted as they come in. Delete the downloaded file from your computer afterwards.</p>
      </form>

      {state?.error && <div className="card text-sm text-red-700">{state.error}</div>}

      {r && (
        <section className="card space-y-4">
          <h2 className="font-semibold">{r.mode === "preview" ? "Preview (nothing saved yet)" : "Imported ✓"}</h2>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Stat label="Clients" value={`${r.totals.clients} (${r.totals.newClients} new)`} />
            <Stat label="WordPress logins" value={r.totals.credentials} />
            <Stat label="Keywords" value={r.totals.keywords} />
            <Stat label="Topics" value={`${r.totals.topics} (${r.totals.drafted} already drafted)`} />
          </div>
          {r.owners.length > 0 && (
            <div className="text-sm">
              <div className="mb-1 font-medium">Team (from &quot;Submitted By&quot;)</div>
              <ul className="space-y-0.5">
                {r.owners.map((o) => (
                  <li key={o.name}>{o.name}: {o.account ? <span className="text-green-700">matched {o.account}</span> : <span className="text-red-700">no account yet</span>}</li>
                ))}
              </ul>
            </div>
          )}
          {r.problems.length > 0 && (
            <div className="rounded bg-amber-50 p-3 text-sm text-amber-900">
              <div className="mb-1 font-medium">Check these</div>
              <ul className="list-disc space-y-0.5 pl-5">{r.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Client</th><th></th><th>Owner</th><th>WordPress</th><th>Keywords</th><th>Topics</th><th>Drafted</th></tr></thead>
              <tbody>
                {r.clients.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td><td className="text-xs text-slate-500">{c.isNew ? "new" : "update"}</td><td>{c.owner ?? "—"}</td>
                    <td>{c.wordpress ? "yes" : <span className="text-red-700">missing</span>}</td><td>{c.keywords}</td><td>{c.topics}</td><td>{c.drafted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded border border-slate-200 p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-lg font-semibold">{value}</div></div>;
}
