import { DataTable } from "@/components/data-table";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { Field, PageHeader } from "@/components/ui";
import { createUserAction, updateUserAction } from "../../actions";
import { SubmitButton } from "@/components/submit-button";

export default async function UsersPage() {
  const me = await requireAdmin();
  const users = await db.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }], include: { _count: { select: { assignments: true } } } });
  const isSuper = me.role === "SUPER_ADMIN";
  const roles = (isSuper ? ["SUPER_ADMIN", "ADMIN", "MEMBER"] : ["ADMIN", "MEMBER"]) as readonly string[];

  return (
    <>
      <PageHeader title="Team" subtitle="Admins can request access to other members' clients. Members only see their assigned clients." />
      <form action={createUserAction} className="card mb-8 grid gap-4 md:grid-cols-5 md:items-end">
        <Field label="Name"><input className="input" name="name" required /></Field>
        <Field label="Email"><input className="input" name="email" type="email" required /></Field>
        <Field label="Temporary password" hint="10+ characters"><input className="input" name="password" type="text" minLength={10} required /></Field>
        <Field label="Role"><select className="input" name="role" defaultValue="MEMBER"><option value="MEMBER">Member</option><option value="ADMIN">Admin</option></select></Field>
        <SubmitButton className="btn-primary">Add team member</SubmitButton>
      </form>

      <div className="card overflow-x-auto p-0">
        <DataTable
          id="users"
          bare
          columns={[{ key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "role", label: "Role", type: "enum" }, { key: "active", label: "Status", type: "enum" }, { key: "clients", label: "Clients", type: "number" }, { key: "edit", label: "Role, status and password", sortable: false, filterable: false }]}
          rows={users.map((u) => ({
            id: u.id,
            values: { name: u.name, email: u.email, role: u.role.replace("_", " ").toLowerCase(), active: u.active ? "active" : "inactive", clients: u._count.assignments, edit: "" },
            cells: {
              name: <span className="font-medium">{u.name}</span>,
              role: <span className="text-xs capitalize">{u.role.replace("_", " ").toLowerCase()}</span>,
              edit: !isSuper && u.role === "SUPER_ADMIN" ? <span className="text-xs text-slate-500">super admin</span> : (
                <form action={updateUserAction.bind(null, u.id)} className="flex flex-wrap items-center gap-2">
                  <select className="input w-36" name="role" defaultValue={u.role}>
                    {roles.map((r) => <option key={r} value={r}>{r.replace("_", " ").toLowerCase()}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={u.active} disabled={u.id === me.id} /> active</label>
                  <input className="input w-40" name="password" placeholder="New password" minLength={10} />
                  <SubmitButton className="btn-secondary">Save</SubmitButton>
                </form>
              ),
            },
          }))}
          searchPlaceholder="Search people"
        />
      </div>
    </>
  );
}
