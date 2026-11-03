import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { ClientForm } from "@/components/client-form";
import { Badge, Field, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { saveWordpressCredentialAction, setAssignmentAction, testWordpressAction, updateClientAction } from "../../../../actions";
import { SubmitButton } from "@/components/submit-button";

export default async function ClientSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const isSuper = user.role === "SUPER_ADMIN";
  const [client, editable, cred, assignments, team] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id } }),
    canEdit(user, id),
    db.clientCredential.findUnique({ where: { clientId_kind: { clientId: id, kind: "WORDPRESS" } } }),
    db.clientAssignment.findMany({ where: { clientId: id }, include: { user: true } }),
    isSuper ? db.user.findMany({ where: { active: true, role: { not: "SUPER_ADMIN" } }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-8">
      <section className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">WordPress access</h2>
          {cred?.lastVerifiedAt ? <Badge color="green">verified {fmtDate(cred.lastVerifiedAt)}</Badge> : cred ? <Badge color="yellow">not verified</Badge> : <Badge color="red">not set</Badge>}
        </div>
        {cred?.lastError && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{cred.lastError}</p>}
        {isSuper ? (
          <form action={saveWordpressCredentialAction.bind(null, id)} className="grid gap-4 md:grid-cols-3">
            <Field label="Draft API endpoint"><input className="input" name="endpoint" defaultValue={cred?.endpoint ?? `${client.siteUrl}/wp-json/wp/v2/posts`} required /></Field>
            <Field label="Username"><input className="input" name="username" defaultValue={cred?.username ?? ""} required /></Field>
            <Field label="Application password" hint={cred ? "Saved and encrypted. Leave empty to keep it." : "Stored encrypted. Never shown again."}>
              <input className="input" name="password" type="password" autoComplete="new-password" placeholder={cred ? "••••••••" : ""} />
            </Field>
            <div className="md:col-span-3"><SubmitButton className="btn-primary">Save</SubmitButton></div>
          </form>
        ) : (
          <p className="text-sm text-slate-600">{cred ? `${cred.endpoint} as ${cred.username}` : "Ask the Super Admin to add WordPress access."}</p>
        )}
        {cred && editable && (
          <form action={testWordpressAction.bind(null, id)}><SubmitButton className="btn-secondary">Test connection</SubmitButton></form>
        )}
      </section>

      {isSuper && (
        <section className="card space-y-4">
          <h2 className="font-semibold">Team access</h2>
          <ul className="space-y-1 text-sm">
            {assignments.map((a) => (
              <li key={a.id} className="flex items-center gap-3"><span className="w-40">{a.user.name}</span><StatusBadge status={a.access} />{a.expiresAt && <span className="text-xs text-slate-400">until {fmtDate(a.expiresAt)}</span>}</li>
            ))}
            {assignments.length === 0 && <li className="text-slate-500">No one assigned yet.</li>}
          </ul>
          <form action={setAssignmentAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
            <Field label="Team member">
              <select className="input" name="userId" required>
                <option value="">Choose…</option>
                {team.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role.toLowerCase()})</option>)}
              </select>
            </Field>
            <Field label="Access">
              <select className="input" name="access" defaultValue="OWNER">
                <option value="OWNER">Owner</option><option value="EDIT">Edit</option><option value="VIEW">View</option><option value="REMOVE">Remove access</option>
              </select>
            </Field>
            <Field label="Expires (optional)"><input className="input" type="date" name="expiresAt" /></Field>
            <SubmitButton className="btn-primary">Save</SubmitButton>
          </form>
        </section>
      )}

      {editable ? (
        <ClientForm client={client} action={updateClientAction.bind(null, id)} submitLabel="Save profile" showStatus={isSuper} />
      ) : (
        <p className="text-sm text-slate-500">You have view-only access to this client.</p>
      )}
    </div>
  );
}
