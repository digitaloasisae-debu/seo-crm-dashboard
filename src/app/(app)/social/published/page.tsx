import { DataTable } from "@/components/data-table";
import { superAdminOnly } from "../guard";
import { db } from "@/lib/db";
import { PageHeader, Empty } from "@/components/ui";
import { fmtLocal } from "@/lib/social/schedule";

export default async function SocialPublished() {
  await superAdminOnly();
  const posts = await db.socialPost.findMany({
    where: { status: { in: ["PUBLISHED", "PUBLISHING", "FAILED"] } },
    select: { id: true, status: true, idea: true, headlineMain: true, publishedAt: true, scheduledAt: true, results: true, imageVersion: true, project: { select: { timezone: true, client: { select: { name: true } } } } },
    orderBy: { scheduledAt: "desc" },
    take: 100,
  });
  if (!posts.length) return <><PageHeader title="Published" /><Empty>Nothing has gone out yet. Approved posts are published by n8n at their time.</Empty></>;
  return (
    <>
      <PageHeader title="Published" subtitle="What went out, with links. Failed platforms show the error; fix it and press Undo approval → Approve on the card to try again." />
      <div className="card overflow-x-auto p-0">
        <DataTable
          id="social-published"
          bare
          columns={[{ key: "img", label: "", sortable: false, filterable: false }, { key: "project", label: "Project", type: "enum" }, { key: "post", label: "Post" }, { key: "when", label: "When", type: "date" }, { key: "platforms", label: "Platforms" }]}
          rows={posts.map((p) => {
            const res = (p.results ?? {}) as Record<string, { url?: string; id?: string; error?: string }>;
            return {
              id: p.id,
              values: { img: "", project: p.project.client.name, post: p.idea, when: (p.publishedAt ?? p.scheduledAt)?.toISOString() ?? null, platforms: Object.keys(res).join(", ") },
              cells: {
                // eslint-disable-next-line @next/next/no-img-element
                img: <img src={`/api/social/image/${p.id}.jpg?v=${p.imageVersion}&w=120`} alt="" className="h-16 w-13 rounded object-cover" />,
                project: <span className="text-sm font-medium">{p.project.client.name}</span>,
                post: <div className="max-w-md text-sm">{p.idea}</div>,
                when: <span className="text-xs whitespace-nowrap text-slate-500">{fmtLocal(p.publishedAt ?? p.scheduledAt, p.project.timezone)}</span>,
                platforms: (
                  <div className="space-y-0.5 text-xs">
                    {Object.entries(res).map(([k, r]) => (
                      <div key={k}>
                        <b className="capitalize">{k}</b>: {r.url ? <a className="text-indigo-600 hover:underline" href={r.url} target="_blank" rel="noreferrer">view</a> : r.error ? <span className="text-red-700">{r.error}</span> : r.id ? "posted" : "waiting"}
                      </div>
                    ))}
                    {p.status === "PUBLISHING" && !Object.keys(res).length && <span className="text-slate-500">sending…</span>}
                  </div>
                ),
              },
            };
          })}
          searchPlaceholder="Search posts"
        />
      </div>
    </>
  );
}
