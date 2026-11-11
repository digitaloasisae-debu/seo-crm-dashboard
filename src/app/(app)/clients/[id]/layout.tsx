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
  const brand = client.brandPrimaryColor && /^#[0-9a-f]{3,8}$/i.test(client.brandPrimaryColor) ? client.brandPrimaryColor : "#5b57e0";
  const GRAD = ["from-indigo-500 to-violet-500", "from-emerald-500 to-cyan-500", "from-amber-400 to-rose-500", "from-fuchsia-500 to-indigo-500", "from-sky-500 to-emerald-500"];
  const grad = (s: string) => GRAD[[...s].reduce((a, ch) => a + ch.charCodeAt(0), 0) % GRAD.length];
  const stars = [[12, 30], [22, 70], [38, 18], [55, 60], [68, 25], [80, 75], [90, 40], [46, 85]];
  const stat = (n: number, label: string, href: string) => (
    <Link href={href} className="rf-glass group rounded-xl px-3 py-2 transition hover:bg-[rgb(255_255_255/.20)]">
      <div className="num text-lg leading-tight font-semibold text-white"><CountUp value={n} /></div>
      <div className="text-[11px] text-[rgb(255_255_255/.70)] group-hover:text-[#fff]">{label}</div>
    </Link>
  );
  return (
    <>
      <section className="rf-banner mb-5 p-5 md:p-6" style={{ ["--brand" as string]: brand }}>
        <span className="blob b1" /><span className="blob b2" /><span className="blob b3" /><span className="grid-fx" />
        <span className="stars" aria-hidden>{stars.map(([x, y], i) => <span key={i} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.6}s` }} />)}</span>
        <div className="flex flex-wrap items-center gap-4 md:gap-5">
          <span className="rf-avatar-ring shrink-0">
            <ClientLogo src={client.logoUrl || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`} initials={initials} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-white md:text-3xl">{client.name}</h1>
              <span className="rf-glass inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-white">
                <span className={`relative h-1.5 w-1.5 rounded-full ${client.status === "ACTIVE" ? "rf-live bg-emerald-400" : "bg-[rgb(255_255_255/.60)]"}`} />
                {client.status === "ACTIVE" ? "Active" : client.status.charAt(0) + client.status.slice(1).toLowerCase()}
              </span>
              {level === "VIEW" && <span className="rf-glass rounded-full px-2.5 py-0.5 text-xs text-white">View only</span>}
            </div>
            <a className="mt-1 inline-flex items-center gap-1.5 text-sm text-[rgb(255_255_255/.75)] transition-colors hover:text-[#fff]" href={client.siteUrl} target="_blank" rel="noreferrer">
              <Icon name="globe" className="h-3.5 w-3.5" />{host}<Icon name="external" className="h-3 w-3" />
            </a>
            <div className="rf-team mt-3 flex items-center -space-x-1.5">
              {people.slice(0, 6).map((u) => (
                <span key={u.id} data-tip={u.name} className={`relative grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br text-[10px] font-semibold text-white ring-2 ring-[#1c1b45] ${grad(u.name)}`}>
                  {u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                </span>
              ))}
              {people.length > 6 && <span className="relative grid h-8 w-8 place-items-center rounded-full bg-[rgb(255_255_255/.20)] text-[10px] font-semibold text-white ring-2 ring-[#1c1b45]">+{people.length - 6}</span>}
              <span className="pl-4 text-xs text-[rgb(255_255_255/.65)]">{people.length} on this client</span>
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
