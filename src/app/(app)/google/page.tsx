import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { googleConfigured, listSites, redirectUri } from "@/lib/google";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { autoMatchAction, removeConnectionAction, setGa4Action, setPropertyAction } from "./actions";
import { listGa4Properties } from "@/lib/analytics";
import { GA_SCOPE } from "@/lib/google";
import { SubmitButton } from "@/components/submit-button";

export const maxDuration = 60;

export default async function GooglePage({ searchParams }: { searchParams: Promise<{ connected?: string; linked?: string; ga?: string; error?: string }> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const configured = googleConfigured();
  const [connections, clients] = await Promise.all([
    db.googleConnection.findMany({ orderBy: { createdAt: "asc" } }),
    db.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, siteUrl: true, gscProperty: true, gscConnectionId: true, gscSyncedAt: true, gscError: true, ga4PropertyId: true, ga4PropertyName: true, ga4ConnectionId: true, ga4SyncedAt: true, ga4Error: true } }),
  ]);
  const [{ sites, errors }, ga] = connections.length ? await Promise.all([listSites(), listGa4Properties()]) : [{ sites: [], errors: [] }, { properties: [], errors: [] }];
  const gaLinked = clients.filter((c) => c.ga4PropertyId).length;
  const linked = clients.filter((c) => c.gscProperty).length;

  return (
    <>
      <PageHeader title="Google" subtitle="Connect the Google accounts that can see your clients' Search Console and Google Analytics. Data refreshes daily, or from a client's SEO and Analytics tabs." />
      {sp.connected && <div className="card mb-4 text-sm text-green-800">Connected {sp.connected}. {sp.linked} more {sp.linked === "1" ? "client was" : "clients were"} linked to Search Console{sp.ga ? ` and ${sp.ga} to Analytics` : ""} automatically.</div>}
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
                <span>{c.email} <span className="text-slate-400">· {sites.filter((s) => s.connectionId === c.id).length} Search Console · {ga.properties.filter((p) => p.connectionId === c.id).length} Analytics</span>{c.lastError && <span className="block text-xs text-red-700">{c.lastError}</span>}{c.scopes && !c.scopes.includes(GA_SCOPE) && !c.lastError && <span className="block text-xs text-amber-700">Connected before Analytics was added: press &quot;Connect a Google account&quot; and pick this account again.</span>}</span>
                <form action={removeConnectionAction.bind(null, c.id)}><button className="text-xs text-red-600 hover:underline">Disconnect</button></form>
              </li>
            ))}
          </ul>
        )}
        {[...errors, ...ga.errors].map((e) => <p key={e} className="text-xs text-red-700">{e}</p>)}
      </section>

      <section className="card p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <h2 className="font-semibold">Clients ({linked} of {clients.length} in Search Console, {gaLinked} in Analytics)</h2>
          {connections.length > 0 && <form action={autoMatchAction}><SubmitButton className="btn-secondary">Auto-match unlinked</SubmitButton></form>}
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Client</th><th>Search Console property</th><th>Last sync</th><th>Google Analytics property</th></tr></thead>
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
                      <SubmitButton className="btn-secondary">Save</SubmitButton>
                    </form>
                  </td>
                  <td className="text-xs text-slate-500">{c.gscError ? <span className="text-red-700">{c.gscError}</span> : c.gscSyncedAt ? fmtDate(c.gscSyncedAt) : "—"}</td>
                  <td>
                    <form action={setGa4Action.bind(null, c.id)} className="flex gap-2">
                      <select name="ga4" className="input max-w-xs" defaultValue={c.ga4PropertyId ? `${c.ga4ConnectionId}|${c.ga4PropertyId}|${c.ga4PropertyName ?? ""}` : ""}>
                        <option value="">Not linked</option>
                        {c.ga4PropertyId && !ga.properties.some((p) => p.id === c.ga4PropertyId && p.connectionId === c.ga4ConnectionId) && <option value={`${c.ga4ConnectionId}|${c.ga4PropertyId}|${c.ga4PropertyName ?? ""}`}>{c.ga4PropertyName ?? c.ga4PropertyId} (no access now)</option>}
                        {ga.properties.map((p) => <option key={`${p.connectionId}|${p.id}`} value={`${p.connectionId}|${p.id}|${p.name}`}>{p.name}{p.hosts[0] ? ` · ${p.hosts[0]}` : ""}{connections.length > 1 ? ` (${p.email})` : ""}</option>)}
                      </select>
                      <SubmitButton className="btn-secondary">Save</SubmitButton>
                    </form>
                    {c.ga4Error && <div className="mt-1 max-w-xs text-xs text-red-700">{c.ga4Error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
