import { superAdminOnly } from "../guard";
import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, Empty } from "@/components/ui";

export default async function SocialProjects() {
  await superAdminOnly();
  const projects = await db.socialProject.findMany({ include: { client: { select: { name: true, siteUrl: true } }, _count: { select: { posts: true, feedback: true } } }, orderBy: { client: { name: "asc" } } });
  return (
    <>
      <PageHeader title="Social projects" subtitle="Your own accounts. Each one uses its client's brand profile, colours and logo." actions={<Link className="btn-primary" href="/social/projects/new">Add project</Link>} />
      {projects.length === 0 ? <Empty>No projects yet.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/social/projects/${p.id}`}>
              <div className={`card space-y-2 ${p.active ? "" : "opacity-60"}`}>
                <div className="flex items-center justify-between"><b>{p.client.name}</b><span className="text-xs text-slate-500">{p.active ? "active" : "paused"}</span></div>
                <div className="text-xs text-slate-500">{p.client.siteUrl}</div>
                <div className="flex flex-wrap gap-1">{p.services.map((s) => <span key={s} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs">{s}</span>)}</div>
                <div className="text-xs text-slate-500">{p.platforms.join(" · ")} · 5 posts a week · {p._count.posts} posts so far · {p._count.feedback} lessons</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
