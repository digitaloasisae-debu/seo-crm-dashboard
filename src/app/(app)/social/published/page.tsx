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
        <table className="table">
          <thead><tr><th></th><th>Project</th><th>Post</th><th>When</th><th>Platforms</th></tr></thead>
          <tbody>
            {posts.map((p) => {
              const res = (p.results ?? {}) as Record<string, { url?: string; id?: string; error?: string }>;
              return (
                <tr key={p.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <td className="w-16"><img src={`/api/social/image/${p.id}.jpg?v=${p.imageVersion}&w=120`} alt="" className="h-16 w-13 rounded object-cover" /></td>
                  <td className="text-sm font-medium">{p.project.client.name}</td>
                  <td className="max-w-md text-sm">{p.idea}</td>
                  <td className="text-xs whitespace-nowrap text-slate-500">{fmtLocal(p.publishedAt ?? p.scheduledAt, p.project.timezone)}</td>
                  <td className="space-y-0.5 text-xs">
                    {Object.entries(res).map(([k, r]) => (
                      <div key={k}>
                        <b className="capitalize">{k}</b>: {r.url ? <a className="text-indigo-600 hover:underline" href={r.url} target="_blank" rel="noreferrer">view</a> : r.error ? <span className="text-red-700">{r.error}</span> : r.id ? "posted" : "waiting"}
                      </div>
                    ))}
                    {p.status === "PUBLISHING" && !Object.keys(res).length && <span className="text-slate-500">sending…</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
