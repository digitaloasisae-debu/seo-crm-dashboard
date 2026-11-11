import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { accessLevel } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Badge, StatusBadge } from "@/components/ui";
import { ClientNav, type GroupedNav } from "@/components/nav";
import { Icon } from "@/components/icons";

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const level = await accessLevel(user, id);
  if (!level) notFound();
  const client = await db.client.findUnique({ where: { id } });
  if (!client) notFound();

  const c = `/clients/${id}`;
  const groups: GroupedNav = [
    { label: "Content", tone: "indigo", icon: "file", items: [
      { href: c, label: "Overview", icon: "briefcase", tip: "Everything about this client at a glance" },
      { href: `${c}/keywords`, label: "Keywords", icon: "tag", tip: "Search terms to write about. Approve them so n8n can use them" },
      { href: `${c}/topics`, label: "Topics", icon: "lightbulb", tip: "Blog ideas made from the keywords. Approve the ones to write" },
      { href: `${c}/articles`, label: "Articles", icon: "file", tip: "Written blogs. Review, edit and send them to WordPress" },
    ] },
    { label: "Growth", tone: "emerald", icon: "trending", items: [
      { href: `${c}/rankings`, label: "Keyword tracking", icon: "trending", tip: "Where the site ranks on Google for each keyword, checked daily" },
      { href: `${c}/refresh`, label: "Traffic recovery", icon: "refresh", tip: "Pages that lost Google clicks, and what to update to win them back" },
      { href: `${c}/analytics`, label: "Analytics", icon: "activity", tip: "Visitors and where they come from (Google Analytics)" },
    ] },
    { label: "Audits", tone: "amber", icon: "stethoscope", items: [
      { href: `${c}/seo`, label: "SEO audit", icon: "chart", tip: "Google search clicks plus a quick speed and on-page check" },
      { href: `${c}/audit`, label: "Full site audit", icon: "stethoscope", tip: "Deep crawl of the whole site with a PDF report for the client" },
      { href: `${c}/backlinks`, label: "Backlinks", icon: "link", tip: "Sites linking to this client, and links competitors have that we don't" },
      { href: `${c}/gbp`, label: "Google Business", icon: "pin", tip: "Google Maps profile: audit, review replies and weekly posts" },
    ] },
    { label: "Setup", tone: "slate", icon: "shield", items: [
      { href: `${c}/brand`, label: "Brand voice", icon: "palette", tip: "How this client sounds. Every AI writer follows it" },
      { href: `${c}/brain`, label: "Writing rules", icon: "brain", tip: "Rules the AI learned from your team's notes, used in every new blog" },
      { href: `${c}/settings`, label: "Settings", icon: "shield", tip: "WordPress login and who on the team can see this client" },
    ] },
  ];
  const initials = client.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-display bg-indigo-600 text-base font-semibold text-white">{initials}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-slate-900 text-2xl font-semibold tracking-tight  md:text-3xl">{client.name}</h1>
            <StatusBadge status={client.status} />
            {level === "VIEW" && <Badge>view only</Badge>}
          </div>
          <a className="mt-0.5 inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-indigo-600" href={client.siteUrl} target="_blank" rel="noreferrer">
            <Icon name="globe" className="h-3.5 w-3.5" />
            {client.siteUrl.replace(/^https?:\/\//, "")}
          </a>
        </div>
      </div>
      <ClientNav groups={groups} />
      {children}
    </>
  );
}
