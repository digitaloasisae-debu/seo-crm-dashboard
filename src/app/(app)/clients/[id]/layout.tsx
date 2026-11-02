import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { accessLevel } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Badge, StatusBadge } from "@/components/ui";

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const level = await accessLevel(user, id);
  if (!level) notFound();
  const client = await db.client.findUnique({ where: { id } });
  if (!client) notFound();

  const tabs = [
    { href: `/clients/${id}`, label: "Overview" },
    { href: `/clients/${id}/keywords`, label: "Keywords" },
    { href: `/clients/${id}/topics`, label: "Topics" },
    { href: `/clients/${id}/articles`, label: "Articles" },
    { href: `/clients/${id}/settings`, label: "Settings" },
  ];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{client.name}</h1>
        <StatusBadge status={client.status} />
        {level === "VIEW" && <Badge>view only</Badge>}
        <a className="text-sm text-slate-500 hover:underline" href={client.siteUrl} target="_blank" rel="noreferrer">{client.siteUrl.replace(/^https?:\/\//, "")}</a>
      </div>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-slate-600 hover:border-slate-300 hover:text-slate-900">{t.label}</Link>
        ))}
      </nav>
      {children}
    </>
  );
}
