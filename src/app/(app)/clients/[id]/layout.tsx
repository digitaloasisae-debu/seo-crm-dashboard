import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { accessLevel } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Badge, StatusBadge } from "@/components/ui";
import { Tabs } from "@/components/nav";
import { Icon } from "@/components/icons";

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const level = await accessLevel(user, id);
  if (!level) notFound();
  const client = await db.client.findUnique({ where: { id } });
  if (!client) notFound();

  const tabs = [
    { href: `/clients/${id}`, label: "Overview", icon: "briefcase" as const },
    { href: `/clients/${id}/keywords`, label: "Keywords", icon: "tag" as const },
    { href: `/clients/${id}/topics`, label: "Topics", icon: "lightbulb" as const },
    { href: `/clients/${id}/articles`, label: "Articles", icon: "file" as const },
    { href: `/clients/${id}/seo`, label: "SEO", icon: "chart" as const },
    { href: `/clients/${id}/audit`, label: "Site audit", icon: "stethoscope" as const },
    { href: `/clients/${id}/backlinks`, label: "Backlinks", icon: "link" as const },
    { href: `/clients/${id}/analytics`, label: "Analytics", icon: "activity" as const },
    { href: `/clients/${id}/brain`, label: "Brain", icon: "sparkles" as const },
    { href: `/clients/${id}/settings`, label: "Settings", icon: "shield" as const },
  ];
  const initials = client.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-base font-bold text-white shadow-lg shadow-indigo-500/25">{initials}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="bg-gradient-to-r from-slate-900 via-indigo-900 to-violet-800 bg-clip-text text-2xl font-bold tracking-tight text-transparent md:text-3xl">{client.name}</h1>
            <StatusBadge status={client.status} />
            {level === "VIEW" && <Badge>view only</Badge>}
          </div>
          <a className="mt-0.5 inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-indigo-600" href={client.siteUrl} target="_blank" rel="noreferrer">
            <Icon name="globe" className="h-3.5 w-3.5" />
            {client.siteUrl.replace(/^https?:\/\//, "")}
          </a>
        </div>
      </div>
      <Tabs items={tabs} />
      {children}
    </>
  );
}
