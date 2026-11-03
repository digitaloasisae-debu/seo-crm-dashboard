import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { googleConfigured, listSites, redirectUri } from "@/lib/google";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { autoMatchAction, removeConnectionAction, setPropertyAction } from "./actions";

export const maxDuration = 60;

export default async function GooglePage({ searchParams }: { searchParams: Promise<{ connected?: string; linked?: string; error?: string }> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const configured = googleConfigured();
  const [connections, clients] = await Promise.all([
    db.googleConnection.findMany({ orderBy: { createdAt: "asc" } }),
    db.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, siteUrl: true, gscProperty: true, gscConnectionId: true, gscSyncedAt: true, gscError: true } }),
  ]);
  const { sites, errors } = connections.length ? await listSites() : { sites: [], errors: [] };
  const linked = clients.filter((c) => c.gscProperty).length;

  return (
    <>
      <PageHeader title="Google Search Console" subtitle="Connect the Google accounts that can see your clients' Search Console. Data refreshes daily, or from a client's SEO tab." />
      {sp.connected && <div className="card mb-4 text-sm text-green-800">Connected {sp.connected}. {sp.linked} more {sp.linked === "1" ? "client was" : "clients were"} linked automatically.</div>}
      {sp.error && <div className="card mb-4 text-sm text-red-700">{sp.error === "not_configured" ? "Google isn't set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel, then redeploy." : `Google: ${sp.error}`}</div>}

      <section className="card mb-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Google accounts</h2>
          {configured ? <a className="btn-primary" href="/api/google/connect">Connect a Google account</a> : <span className="text-sm text-amber-700">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel first.</span>}
        </div>
        {configured && <p className="text-xs text-slate-500">Authorized redirect URI for Google Cloud: <code>{redirectUri()}</code></p>}
        {connections.length === 0 ? <p className="text-sm text-slate-500">No accounts connected yet.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{c.email} <span className="text-slate-400">· {sites.filter((s) => s.connectionId === c.id).length} properties</span>{c.lastError && <span className="block text-xs text-red-700">{c.lastError}</span>}</span>
                <form action={removeConnectionAction.bind(null, c.id)}><button className="text-xs text-red-600 hover:underline">Disconnect</button></form>
              </li>
            ))}
          </ul>
        )}
        {errors.map((e) => <p key={e} className="text-xs text-red-700">{e}</p>)}
      </section>

      <section className="card p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <h2 className="font-semibold">Clients ({linked} of {clients.length} linked)</h2>
          {connections.length > 0 && <form action={autoMatchAction}><button className="btn-secondary">Auto-match unlinked</button></form>}
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Client</th><th>Search Console property</th><th>Last sync</th></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}<div className="text-xs text-slate-400">{c.siteUrl.replace(/^https?:\/\//, "")}</div></td>
                  <td>
                    <form action={setPropertyAction.bind(null, c.id)} className="flex gap-2">
                      <select name="property" className="input max-w-xs" defaultValue={c.gscProperty ? `${c.gscConnectionId}|${c.gscProperty}` : ""}>
                        <option value="">Not linked</option>
                        {c.gscProperty && !sites.some((s) => s.siteUrl === c.gscProperty && s.connectionId === c.gscConnectionId) && <option value={`${c.gscConnectionId}|${c.gscProperty}`}>{c.gscProperty} (no access now)</option>}
                        {sites.map((s) => <option key={`${s.connectionId}|${s.siteUrl}`} value={`${s.connectionId}|${s.siteUrl}`}>{s.siteUrl}{connections.length > 1 ? ` (${s.email})` : ""}</option>)}
                      </select>
                      <button className="btn-secondary">Save</button>
                    </form>
                  </td>
                  <td className="text-xs text-slate-500">{c.gscError ? <span className="text-red-700">{c.gscError}</span> : c.gscSyncedAt ? fmtDate(c.gscSyncedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
