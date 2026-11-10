import Link from "next/link";
import type { ReactNode } from "react";
import { superAdminOnly } from "./guard";

/** Social Studio is for the Super Admin only. Everyone else gets a plain 404, even with a direct link. */
export default async function SocialLayout({ children }: { children: ReactNode }) {
  await superAdminOnly();
  const tabs = [
    ["/social", "Review"],
    ["/social/calendar", "Calendar"],
    ["/social/published", "Published"],
    ["/social/projects", "Projects"],
  ];
  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-1 border-b border-slate-200 text-sm">
        {tabs.map(([href, label]) => (
          <Link key={href} href={href} className="-mb-px border-b-2 border-transparent px-3 py-2 font-medium text-slate-600 hover:border-indigo-300 hover:text-slate-900">
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
