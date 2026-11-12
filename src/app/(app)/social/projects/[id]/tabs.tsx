import Link from "next/link";

/** Sub-tabs of one social project. */
export function ProjectTabs({ id, active }: { id: string; active: "settings" | "research" | "photos" }) {
  const tabs = [
    ["settings", `/social/projects/${id}`, "Settings and learning"],
    ["research", `/social/projects/${id}/research`, "Competitor research"],
    ["photos", `/social/projects/${id}/photos`, "Photo library"],
  ] as const;
  return (
    <div className="mb-5 flex flex-wrap gap-1">
      {tabs.map(([k, href, label]) => (
        <Link key={k} href={href} className={`rounded-md px-3 py-1.5 text-sm font-medium ${active === k ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
          {label}
        </Link>
      ))}
    </div>
  );
}
