import Link from "next/link";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q } = await searchParams;
  const clients = await db.client.findMany({
    where: { ...clientScope(user), ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
    orderBy: { name: "asc" },
    include: {
      assignments: { where: { access: "OWNER" }, include: { user: { select: { name: true } } } },
      _count: {
        select: {
          keywords: { where: { status: "APPROVED", used: false } },
          topics: { where: { status: "GENERATED" } },
          articles: { where: { status: { in: ["READY_FOR_REVIEW", "APPROVED", "PUSH_FAILED"] } } },
        },
      },
    },
  });

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} ${user.role === "SUPER_ADMIN" ? "in total" : "you can see"}`}
        actions={user.role === "SUPER_ADMIN" && <Link className="btn-primary" href="/clients/new">Add client</Link>}
      />
      <form className="mb-4">
        <input className="input max-w-xs" name="q" defaultValue={q} placeholder="Search clients" />
      </form>
      {clients.length === 0 ? (
        <Empty>No clients yet. They appear here when the onboarding Tally form is submitted.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr><th>Client</th><th>Owner</th><th>Status</th><th>Posts / mo</th><th>Unused keywords</th><th>Topics to review</th><th>Articles waiting</th></tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="font-medium text-indigo-600 hover:underline" href={`/clients/${c.id}`}>{c.name}</Link>
                    <div className="text-xs text-slate-400">{c.siteUrl.replace(/^https?:\/\//, "")}</div>
                  </td>
                  <td>{c.assignments.map((a) => a.user.name).join(", ") || <span className="text-slate-400">Unassigned</span>}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{c.postsPerMonth}</td>
                  <td>{c._count.keywords}</td>
                  <td>{c._count.topics}</td>
                  <td>{c._count.articles}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
