import { DataTable } from "@/components/data-table";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Empty, Field, PageHeader, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { decideAccessAction, requestAccessAction } from "../../actions";
import { SubmitButton } from "@/components/submit-button";

export default async function AccessPage() {
  const user = await requireUser();
  if (user.role === "MEMBER") return <Empty>Access requests are for admins.</Empty>;

  if (user.role === "SUPER_ADMIN") {
    const requests = await db.accessRequest.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { client: { select: { name: true } }, requester: { select: { name: true } } },
      take: 100,
    });
    return (
      <>
        <PageHeader title="Access requests" subtitle="Admins ask here to oversee another member's client." />
        {requests.length === 0 ? <Empty>No requests yet.</Empty> : (
          <div className="card overflow-x-auto p-0">
            <DataTable
              id="access"
              bare
              columns={[{ key: "requested", label: "Requested", type: "date" }, { key: "who", label: "Who", type: "enum" }, { key: "client", label: "Client", type: "enum" }, { key: "access", label: "Access", type: "enum" }, { key: "reason", label: "Reason" }, { key: "status", label: "Decision", type: "enum" }]}
              rows={requests.map((r) => ({
                id: r.id,
                values: { requested: r.createdAt.toISOString(), who: r.requester.name, client: r.client.name, access: r.access, reason: r.reason ?? "", status: r.status },
                cells: {
                  requested: <span className="whitespace-nowrap">{fmtDate(r.createdAt)}</span>,
                  access: <StatusBadge status={r.access} />,
                  reason: <div className="max-w-xs text-sm">{r.reason}</div>,
                  status: r.status === "PENDING" ? (
                    <form className="flex flex-wrap gap-2">
                      <input className="input w-36" type="date" name="expiresAt" title="Optional expiry" />
                      <SubmitButton data-celebrate="approved" formAction={decideAccessAction.bind(null, r.id, true)} className="btn-primary">Approve</SubmitButton>
                      <SubmitButton formAction={decideAccessAction.bind(null, r.id, false)} className="btn-danger">Deny</SubmitButton>
                    </form>
                  ) : <StatusBadge status={r.status} />,
                },
              }))}
              presets={[{ label: "Pending", filters: { status: ["PENDING"] } }]}
              searchPlaceholder="Search requests"
            />
          </div>
        )}
      </>
    );
  }

  // ADMIN: request access to clients outside their scope (names only).
  const [visible, all, mine] = await Promise.all([
    db.client.findMany({ where: clientScope(user, "edit"), select: { id: true } }),
    db.client.findMany({ where: { status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.accessRequest.findMany({ where: { requesterId: user.id }, include: { client: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const have = new Set(visible.map((c) => c.id));
  const others = all.filter((c) => !have.has(c.id));

  return (
    <>
      <PageHeader title="Request access" subtitle="Ask the Super Admin for access to a client another member owns." />
      <form action={requestAccessAction} className="card mb-8 grid gap-4 md:grid-cols-4 md:items-end">
        <Field label="Client">
          <select className="input" name="clientId" required>
            <option value="">Choose…</option>
            {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Access"><select className="input" name="access" defaultValue="VIEW"><option value="VIEW">View</option><option value="EDIT">Edit (approve and push)</option></select></Field>
        <Field label="Reason"><input className="input" name="reason" placeholder="Review Aiman's approved topics" /></Field>
        <SubmitButton className="btn-primary">Send request</SubmitButton>
      </form>
      <h2 className="mb-3 font-semibold">My requests</h2>
      {mine.length === 0 ? <Empty>No requests yet.</Empty> : (
        <ul className="card divide-y divide-slate-100 p-0">
          {mine.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>{r.client.name} · {r.access.toLowerCase()}</span>
              <span className="flex items-center gap-2"><span className="text-slate-400">{fmtDate(r.createdAt)}</span><StatusBadge status={r.status} /></span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
