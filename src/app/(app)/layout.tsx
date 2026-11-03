import Link from "next/link";
import { requireUser } from "@/lib/session";
import { logoutAction } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const nav = [
    { href: "/", label: "Waiting on me" },
    { href: "/clients", label: "Clients" },
    ...(user.role !== "MEMBER" ? [{ href: "/intake", label: "Intake" }, { href: "/access", label: "Access" }] : []),
    ...(user.role === "SUPER_ADMIN" ? [{ href: "/users", label: "Team" }, { href: "/import", label: "Import" }] : []),
  ];
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:min-h-screen md:w-56 md:border-r md:border-b-0">
        <div className="p-4 text-sm font-semibold">SEO Control Center</div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm whitespace-nowrap text-slate-700 hover:bg-slate-100">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-2 text-xs text-slate-500 md:block md:p-4">
          <div className="font-medium text-slate-700">{user.name}</div>
          <div>{user.role.replace("_", " ").toLowerCase()}</div>
          <form action={logoutAction} className="mt-2">
            <button className="text-indigo-600 hover:underline">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
