import Link from "next/link";
import { requireUser } from "@/lib/session";
import { logoutAction } from "../actions";
import { SideNav, type NavItem } from "@/components/nav";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { Celebrate } from "@/components/celebrate";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const nav: NavItem[] = [
    { href: "/", label: "Waiting on me", icon: "inbox" },
    { href: "/clients", label: "Clients", icon: "briefcase" },
    { href: "/seo", label: "SEO", icon: "chart" },
    ...(user.role !== "MEMBER"
      ? ([
          { href: "/intake", label: "Intake", icon: "zap", group: "Admin" },
          { href: "/access", label: "Access", icon: "key", group: "Admin" },
        ] as NavItem[])
      : []),
    ...(user.role === "SUPER_ADMIN"
      ? ([
          { href: "/users", label: "Team", icon: "users", group: "Admin" },
          { href: "/google", label: "Google", icon: "globe", group: "Admin" },
          { href: "/import", label: "Import", icon: "upload", group: "Admin" },
        ] as NavItem[])
      : []),
  ];
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="min-h-screen md:flex">
      <aside className="relative z-10 overflow-hidden bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-white md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col">
        <div className="pointer-events-none absolute -top-24 -left-20 h-64 w-64 animate-float rounded-full bg-indigo-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-64 w-64 animate-float rounded-full bg-fuchsia-500/15 blur-3xl [animation-delay:-7s]" />
        <Link href="/" className="relative block px-5 py-5 transition-opacity hover:opacity-90">
          <Logo size={34} light animated />
        </Link>
        <div className="relative md:flex-1 md:overflow-y-auto">
          <SideNav items={nav} />
        </div>
        <div className="relative m-3 hidden rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur md:block">
          <Link href="/profile" className="group flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-xs font-semibold ring-2 ring-white/20 transition group-hover:ring-white/40">
              {initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block text-[11px] text-indigo-200/60 capitalize">{user.role.replace("_", " ").toLowerCase()}</span>
            </span>
          </Link>
          <div className="mt-3 flex gap-2">
            <Link href="/profile" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-2 py-1.5 text-xs transition hover:bg-white/20">
              <Icon name="user" className="h-3.5 w-3.5" /> Profile
            </Link>
            <form action={logoutAction} className="flex-1">
              <button className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-white/10 px-2 py-1.5 text-xs transition hover:bg-red-500/30">
                <Icon name="logout" className="h-3.5 w-3.5" /> Sign out
              </button>
            </form>
          </div>
        </div>
        <div className="relative flex items-center justify-between border-t border-white/10 px-4 py-2 text-xs md:hidden">
          <Link href="/profile" className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-semibold">{initials}</span>
            {user.name}
          </Link>
          <form action={logoutAction}>
            <button className="cursor-pointer text-indigo-200 hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>
      <Celebrate />
      <main className="page-enter mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
