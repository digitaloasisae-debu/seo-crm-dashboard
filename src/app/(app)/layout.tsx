import Link from "next/link";
import { requireUser } from "@/lib/session";
import { logoutAction } from "../actions";
import { SideNav, type NavItem } from "@/components/nav";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { Celebrate } from "@/components/celebrate";
import { CommandMenu, SearchButton, ThemeToggle, Toaster } from "@/components/shell";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/access";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const nav: NavItem[] = [
    { href: "/", label: "Today", icon: "inbox" },
    { href: "/clients", label: "Clients", icon: "briefcase" },
    { href: "/seo", label: "SEO overview", icon: "chart" },
    ...(user.role !== "MEMBER"
      ? ([
          { href: "/intake", label: "Intake", icon: "zap", group: "Admin" },
          { href: "/access", label: "Access", icon: "key", group: "Admin" },
          { href: "/users", label: "Team", icon: "users", group: "Admin" },
        ] as NavItem[])
      : []),
    ...(user.role === "SUPER_ADMIN"
      ? ([
          { href: "/social", label: "Social", icon: "message", group: "Admin" },
          { href: "/sop", label: "SOP", icon: "check", group: "Admin" },
          { href: "/google", label: "Google", icon: "globe", group: "Admin" },
          { href: "/import", label: "Import", icon: "upload", group: "Admin" },
        ] as NavItem[])
      : []),
  ];
  const scope = { client: clientScope(user, "edit") };
  const [clients, waiting] = await Promise.all([
    db.client.findMany({ where: clientScope(user), select: { id: true, name: true, siteUrl: true }, orderBy: { name: "asc" } }),
    Promise.all([
      db.keyword.count({ where: { ...scope, status: "PENDING" } }),
      db.topic.count({ where: { ...scope, status: "GENERATED" } }),
      db.article.count({ where: { ...scope, status: "READY_FOR_REVIEW" } }),
      db.gbpReview.count({ where: { ...scope, status: "DRAFTED" } }),
      db.gbpPost.count({ where: { ...scope, status: "DRAFTED" } }),
    ]).then((n) => n.reduce((a, b) => a + b, 0)),
  ]);
  nav[0].badge = waiting;
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="min-h-screen md:flex">
      <aside className="rf-side relative z-10 border-b md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-5 py-4">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo size={26} />
          </Link>
          <div className="rf-side-btn rounded-md md:hidden [&_button]:!text-inherit [&_button:hover]:!bg-transparent"><ThemeToggle /></div>
        </div>
        <div className="md:flex-1 md:overflow-y-auto">
          <SideNav items={nav} />
        </div>
        <div className="hidden items-center gap-1 border-t border-white/10 p-3 md:flex" style={{ borderColor: "rgb(255 255 255 / 0.08)" }}>
          <Link href="/profile" data-tip="Your profile and password" className="rf-side-hover group flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 transition-colors">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f5b83d] text-[11px] font-semibold text-[#1c1b45]">
              {initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-tight font-medium text-white">{user.name}</span>
              <span className="rf-side-muted block text-[11px] leading-tight capitalize">{user.role.replace("_", " ").toLowerCase()}</span>
            </span>
          </Link>
          <form action={logoutAction}>
            <button aria-label="Sign out" data-tip="Sign out" className="rf-side-btn flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-colors">
              <Icon name="logout" className="h-4 w-4" />
            </button>
          </form>
        </div>
      </aside>
      <Celebrate />
      <Toaster />
      <CommandMenu clients={clients.map((c) => ({ id: c.id, name: c.name, site: c.siteUrl }))} links={nav.map((n) => ({ href: n.href, label: n.label, icon: n.icon }))} />
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 hidden items-center gap-3 border-b border-slate-200/70 bg-slate-50/85 px-8 py-2.5 backdrop-blur-md md:flex">
          <SearchButton />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
        <div className="px-4 pt-3 md:hidden"><SearchButton /></div>
        <main className="page-enter mx-auto w-full max-w-6xl p-4 md:px-8 md:pt-6 md:pb-12">{children}</main>
      </div>
    </div>
  );
}
