import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { Field, PageHeader } from "@/components/ui";
import { createUserAction, updateUserAction } from "../../actions";
import { SubmitButton } from "@/components/submit-button";

export default async function UsersPage() {
  const me = await requireSuperAdmin();
  const users = await db.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }], include: { _count: { select: { assignments: true } } } });
  const roles = ["SUPER_ADMIN", "ADMIN", "MEMBER"] as const;

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
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Clients</th><th>Role, status and password</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.name}</td>
                <td>{u.email}</td>
                <td>{u._count.assignments}</td>
                <td>
                  <form action={updateUserAction.bind(null, u.id)} className="flex flex-wrap items-center gap-2">
                    <select className="input w-36" name="role" defaultValue={u.role}>
                      {roles.map((r) => <option key={r} value={r}>{r.replace("_", " ").toLowerCase()}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={u.active} disabled={u.id === me.id} /> active</label>
                    <input className="input w-40" name="password" placeholder="New password" minLength={10} />
                    <SubmitButton className="btn-secondary">Save</SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
