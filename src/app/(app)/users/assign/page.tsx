import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { assignClientsAction, setClientOwnerAction } from "../../../actions";

const ACCESS = { OWNER: "Owner", EDIT: "Edit", VIEW: "View" } as Record<string, string>;

export default async function AssignClientsPage({ searchParams }: { searchParams: Promise<{ member?: string }> }) {
  await requireAdmin();
  const { member } = await searchParams;
  const [team, clients] = await Promise.all([
    db.user.findMany({ where: { active: true, role: { in: ["ADMIN", "MEMBER"] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    db.client.findMany({
      where: { status: { not: "ARCHIVED" }, socialOnly: false },
      select: { id: true, name: true, status: true, assignments: { select: { userId: true, access: true, user: { select: { name: true } } } } },
      orderBy: { name: "asc" },
    }),
  ]);
  const picked = team.find((u) => u.id === member);
  const ownerOf = (c: (typeof clients)[number]) => c.assignments.find((a) => a.access === "OWNER");

  return (
    <>
      <PageHeader title="Assign clients" subtitle="Choose who works on each client. The owner is responsible for the client and sees its tasks on the Today page. Edit can approve and send. View is read only." actions={<Link href="/users" className="btn-secondary">Back to Team</Link>} />

      <form action={assignClientsAction} className="card mb-8 space-y-4">
        <div>
          <h2 className="font-semibold">Give a member clients</h2>
          <p className="text-sm text-slate-500">Pick a member, tick the clients, choose the access and save. Making someone the owner moves the old owner to Edit.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Team member">
            <select className="input w-56" name="userId" defaultValue={picked?.id ?? ""} required>
              <option value="" disabled>Choose a member</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role === "ADMIN" ? " (admin)" : ""}</option>)}
            </select>
          </Field>
          <Field label="Access">
            <select className="input w-44" name="access" defaultValue="OWNER">
              <option value="OWNER">Owner</option><option value="EDIT">Edit (helper)</option><option value="VIEW">View only</option><option value="REMOVE">Remove access</option>
            </select>
          </Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => {
            const mine = picked && c.assignments.find((a) => a.userId === picked.id);
            const owner = ownerOf(c);
            return (
              <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm transition select-none hover:border-indigo-300 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50">
                <input type="checkbox" name="clientId" value={c.id} className="mt-0.5 accent-indigo-600" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}{c.status === "PAUSED" && <span className="ml-1 text-xs font-normal text-slate-400">paused</span>}</span>
                  <span className="block text-xs text-slate-500">
                    {owner ? `Owner: ${owner.user.name}` : <span className="text-amber-700">No owner</span>}
                    {mine && <> · {picked!.name} has {ACCESS[mine.access]}</>}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <SubmitButton className="btn-primary">Save</SubmitButton>
      </form>

      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">Owner of each client</h2>
          <p className="text-sm text-slate-500">Change the owner of one client here. The old owner keeps Edit access; remove it in the client&apos;s Settings if needed.</p>
        </div>
        <ul className="divide-y divide-slate-100">
          {clients.map((c) => {
            const owner = ownerOf(c);
            const helpers = c.assignments.filter((a) => a.access !== "OWNER");
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-48 flex-1">
                  <Link href={`/clients/${c.id}/settings`} className="text-sm font-medium hover:text-indigo-600">{c.name}</Link>
                  {helpers.length > 0 && <div className="text-xs text-slate-500">Also: {helpers.map((a) => `${a.user.name} (${ACCESS[a.access].toLowerCase()})`).join(", ")}</div>}
                </div>
                <form action={setClientOwnerAction.bind(null, c.id)} className="flex items-center gap-2">
                  <select className="input w-48" name="ownerId" defaultValue={owner?.userId ?? ""} aria-label={`Owner of ${c.name}`}>
                    <option value="">No owner</option>
                    {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <SubmitButton className="btn-secondary">Save</SubmitButton>
                </form>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
