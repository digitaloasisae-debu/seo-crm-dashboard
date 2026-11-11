import Link from "next/link";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import { DataTable } from "@/components/data-table";

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
      {clients.length === 0 ? (
        <Empty>No clients yet. They appear here when the onboarding Tally form is submitted.</Empty>
      ) : (
        <DataTable
          id="clients"
          columns={[
            { key: "name", label: "Client" },
            { key: "owner", label: "Owner", type: "enum" },
            { key: "status", label: "Status", type: "enum" },
            { key: "posts", label: "Posts / mo", type: "number" },
            { key: "keywords", label: "Unused keywords", type: "number" },
            { key: "topics", label: "Topics to review", type: "number" },
            { key: "articles", label: "Articles waiting", type: "number" },
            { key: "site", label: "Website", hidden: true },
          ]}
          rows={clients.map((c) => ({
            id: c.id,
            href: `/clients/${c.id}`,
            values: { name: c.name, owner: c.assignments.map((a) => a.user.name).join(", ") || "Unassigned", status: c.status, posts: c.postsPerMonth, keywords: c._count.keywords, topics: c._count.topics, articles: c._count.articles, site: c.siteUrl.replace(/^https?:\/\//, "") },
            cells: {
              name: (
                <div>
                  <Link className="font-medium text-indigo-600 hover:underline" href={`/clients/${c.id}`}>{c.name}</Link>
                  <div className="text-xs text-slate-400">{c.siteUrl.replace(/^https?:\/\//, "")}</div>
                </div>
              ),
              owner: c.assignments.map((a) => a.user.name).join(", ") || <span className="text-slate-400">Unassigned</span>,
              status: <StatusBadge status={c.status} />,
              topics: c._count.topics ? <Link href={`/clients/${c.id}/topics?status=GENERATED`} className="num font-medium text-amber-700 hover:underline">{c._count.topics}</Link> : <span className="num text-slate-400">0</span>,
              articles: c._count.articles ? <Link href={`/clients/${c.id}/articles`} className="num font-medium text-amber-700 hover:underline">{c._count.articles}</Link> : <span className="num text-slate-400">0</span>,
            },
          }))}
          presets={[
            { label: "Active", filters: { status: ["ACTIVE"] } },
            { label: "Needs review", filters: { topics: ">0" } },
            { label: "Articles waiting", filters: { articles: ">0" } },
            { label: "Low on keywords", filters: { keywords: "<5", status: ["ACTIVE"] } },
          ]}
          searchPlaceholder="Search clients"
          defaultSort={{ key: "name", dir: "asc" }}
        />
      )}
    </>
  );
}
