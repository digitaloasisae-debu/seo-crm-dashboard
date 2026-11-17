import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { accessLevel } from "@/lib/access";
import { requireUser } from "@/lib/session";
import Link from "next/link";
import { ClientTabs, type GroupedNav } from "@/components/nav";
import { CountUp } from "@/components/fun";
import { ClientLogo } from "@/components/client-logo";
import { Icon } from "@/components/icons";

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const level = await accessLevel(user, id);
  if (!level) notFound();
  const client = await db.client.findUnique({ where: { id } });
  if (!client) notFound();

  const [team, waitKw, waitTopics, waitArts, live, losing, gbpDrafts, admins] = await Promise.all([
    db.clientAssignment.findMany({ where: { clientId: id, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { user: { select: { id: true, name: true, active: true } } } }),
    db.keyword.count({ where: { clientId: id, status: "PENDING" } }),
    db.topic.count({ where: { clientId: id, status: "GENERATED" } }),
    db.article.count({ where: { clientId: id, status: "READY_FOR_REVIEW" } }),
    db.article.count({ where: { clientId: id, status: "PUSHED_DRAFT" } }),
    db.contentRefresh.count({ where: { clientId: id, status: { in: ["OPEN", "DRAFTED"] } } }),
    db.gbpReview.count({ where: { clientId: id, status: "DRAFTED" } }).then(async (n) => n + (await db.gbpPost.count({ where: { clientId: id, status: "DRAFTED" } }))),
    db.user.findMany({ where: { active: true, role: { in: ["ADMIN", "SUPER_ADMIN"] } }, select: { id: true, name: true, active: true } }),
  ]);
  const people = [...new Map([...admins, ...team.map((t) => t.user)].filter((u) => u.active).map((u) => [u.id, u])).values()];
  const c = `/clients/${id}`;
  const groups: GroupedNav = [
    { label: "Content", tone: "indigo", icon: "file", blurb: "Keywords, topics, blogs", items: [
      { href: c, label: "Overview", icon: "briefcase", tip: "Everything about this client at a glance" },
      { href: `${c}/keywords`, label: "Keywords", icon: "tag", tip: "Search terms to write about. Approve them so n8n can use them", badge: waitKw },
      { href: `${c}/topics`, label: "Topics", icon: "lightbulb", tip: "Blog ideas made from the keywords. Approve the ones to write", badge: waitTopics },
      { href: `${c}/articles`, label: "Articles", icon: "file", tip: "Written blogs. Review, edit and send them to WordPress", badge: waitArts },
    ] },
    { label: "Growth", tone: "emerald", icon: "trending", blurb: "Rankings and traffic", items: [
      { href: `${c}/rankings`, label: "Keyword tracking", icon: "trending", tip: "Where the site ranks on Google for each keyword, checked daily" },
      { href: `${c}/refresh`, label: "Traffic recovery", icon: "refresh", tip: "Pages that lost Google clicks, and what to update to win them back", badge: losing },
      { href: `${c}/analytics`, label: "Analytics", icon: "activity", tip: "Visitors and where they come from (Google Analytics)" },
    ] },
    { label: "Audits", tone: "amber", icon: "stethoscope", blurb: "Site health checks", items: [
      { href: `${c}/seo`, label: "SEO audit", icon: "chart", tip: "Google search clicks plus a quick speed and on-page check" },
      { href: `${c}/audit`, label: "Full site audit", icon: "stethoscope", tip: "Deep crawl of the whole site with a PDF report for the client" },
      { href: `${c}/backlinks`, label: "Backlinks", icon: "link", tip: "Sites linking to this client, and links competitors have that we don't" },
      { href: `${c}/gbp`, label: "Google Business", icon: "pin", tip: "Google Maps profile: audit, review replies and weekly posts", badge: gbpDrafts },
    ] },
    { label: "Setup", tone: "violet", icon: "palette", blurb: "Voice, rules, access", items: [
      { href: `${c}/brand`, label: "Brand voice", icon: "palette", tip: "How this client sounds. Every AI writer follows it" },
      { href: `${c}/brain`, label: "Writing rules", icon: "brain", tip: "Rules the AI learned from your team's notes, used in every new blog" },
      { href: `${c}/settings`, label: "Settings", icon: "shield", tip: "WordPress login and who on the team can see this client" },
    ] },
  ];
  const initials = client.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const host = client.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const stat = (n: number, label: string, href: string) => (
    <Link href={href} className="group rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 transition hover:border-indigo-200 hover:bg-indigo-50">
      <div className="num rf-num-serif text-[26px] leading-tight text-slate-900"><CountUp value={n} /></div>
      <div className="text-[11px] text-slate-500 group-hover:text-indigo-700">{label}</div>
    </Link>
  );
  return (
    <>
      {/* Client header: calm and professional (white card, plum accents). No per-client colours or animation. */}
      <section className="card mb-5 !p-5 md:!p-6 print:hidden">
        <div className="flex flex-wrap items-center gap-4 md:gap-5">
          <span className="shrink-0 rounded-[1.05rem] border border-slate-200 p-0.5">
            <ClientLogo src={client.logoUrl || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`} initials={initials} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">{client.name}</h1>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${client.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${client.status === "ACTIVE" ? "bg-emerald-500" : "bg-slate-400"}`} />
                {client.status === "ACTIVE" ? "Active" : client.status.charAt(0) + client.status.slice(1).toLowerCase()}
              </span>
              {level === "VIEW" && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">View only</span>}
            </div>
            <a className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-indigo-700" href={client.siteUrl} target="_blank" rel="noreferrer">
              <Icon name="globe" className="h-3.5 w-3.5" />{host}<Icon name="external" className="h-3 w-3" />
            </a>
            <div className="mt-3 flex items-center -space-x-1.5">
              {people.slice(0, 6).map((u) => (
                <span key={u.id} data-tip={u.name} className="relative grid h-8 w-8 place-items-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white ring-2 ring-white">
                  {u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                </span>
              ))}
              {people.length > 6 && <span className="relative grid h-8 w-8 place-items-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700 ring-2 ring-white">+{people.length - 6}</span>}
              <span className="pl-4 text-xs text-slate-500">{people.length} on this client</span>
            </div>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 sm:w-auto">
            {stat(waitKw + waitTopics + waitArts, "Waiting on you", `${c}/articles`)}
            {stat(live, "On WordPress", `${c}/articles`)}
            {stat(losing, "Losing traffic", `${c}/refresh`)}
          </div>
        </div>
      </section>
      <ClientTabs groups={groups} />
      {children}
    </>
  );
}
