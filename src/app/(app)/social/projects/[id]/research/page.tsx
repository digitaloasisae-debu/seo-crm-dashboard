import { notFound } from "next/navigation";
import { superAdminOnly } from "../../../guard";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { fmtDate } from "@/lib/utils";
import { metaConfigured, type Research } from "@/lib/social/research";
import { saveCompetitorsAction } from "../../../actions";
import { ProjectTabs } from "../tabs";

export const maxDuration = 300;

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-slate-900">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  );
}

const num = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString("en-US"));

export default async function SocialResearchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; saved?: string; done?: string }> }) {
  await superAdminOnly();
  const { id } = await params;
  const sp = await searchParams;
  const p = await db.socialProject.findUnique({ where: { id }, include: { client: { select: { name: true } } } });
  if (!p) notFound();
  const since = new Date(Date.now() - 120 * 864e5);
  const [rivals, own] = await Promise.all([
    db.socialRivalPost.findMany({ where: { projectId: id, isOwn: false, postedAt: { gte: since } }, orderBy: { engagement: "desc" }, take: 20 }),
    db.socialRivalPost.findMany({ where: { projectId: id, isOwn: true }, orderBy: { postedAt: "desc" }, take: 20 }),
  ]);
  const r = p.research as Research | null;
  return (
    <>
      <PageHeader title={p.client.name} subtitle="What competitors post, what wins, and what we learn from it. Ideas and captions use these findings indirectly: never copied, never named." />
      <ProjectTabs id={id} active="research" />
      {sp.err && <p className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{sp.err}</p>}
      {sp.saved && <p className="mb-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">Saved.</p>}
      {sp.done && <p className="mb-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">Research updated. The next month you generate will use it.</p>}
      {!metaConfigured() && <p className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Add META_ACCESS_TOKEN (your long-lived Meta token) in Vercel so competitors&apos; Instagram posts can be read. Until then research can't run.</p>}

      <div className="space-y-6">
        <form action={saveCompetitorsAction.bind(null, id)} className="card space-y-4">
          <div className="max-w-xl">
            <label className="block">
              <span className="label">Competitor Instagram accounts (one per line, @name or link)</span>
              <textarea name="competitors" rows={6} defaultValue={p.competitors.map((h) => `@${h}`).join("\n")} className="input text-sm" placeholder={"@competitor_one\n@competitor_two"} />
              <span className="mt-1 block text-xs text-slate-500">Business or creator accounts only (personal accounts can&apos;t be read). Up to 12.</span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton name="run" value="1" className="btn-primary">Save and run research</SubmitButton>
            <SubmitButton name="run" value="0" className="btn-secondary text-xs">Just save</SubmitButton>
            <span className="text-xs text-slate-500">
              {p.researchAt ? `Last run ${fmtDate(p.researchAt)}. ` : ""}It also refreshes by itself before a month is generated if it&apos;s older than 2 weeks. Takes about a minute.
            </span>
          </div>
          {p.researchError && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Last run: {p.researchError}</p>}
        </form>

        {r?.summary && (
          <section className="card space-y-4">
            <h2 className="text-lg font-semibold">What we learned</h2>
            <p className="text-sm text-slate-700">{r.summary}</p>
            {r.stats && r.stats.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-500"><tr><th className="py-1 pr-3">Account</th><th className="pr-3">Followers</th><th className="pr-3">Posts (120 days)</th><th className="pr-3">Per week</th><th>Avg engagement</th></tr></thead>
                  <tbody>
                    {r.stats.map((s) => (
                      <tr key={s.handle} className="border-t border-slate-100">
                        <td className="py-1 pr-3 font-medium">@{s.handle}{own[0]?.handle === s.handle ? " (us)" : ""}</td>
                        <td className="pr-3">{num(s.followers)}</td><td className="pr-3">{s.posts}</td><td className="pr-3">{s.perWeek}</td><td>{s.avgEngagement}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid gap-5 md:grid-cols-2">
              <List title="What they target" items={r.targeting} />
              <List title="Gaps we can own" items={r.gaps} />
              <List title="Formats that win" items={r.formats} />
              <List title="Opening lines that win" items={r.hooks} />
              <List title="Caption patterns" items={r.captions} />
              <List title="What their best images look like" items={r.visuals} />
              <List title="What gets ignored" items={r.flops} />
              {r.winners.length > 0 && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-900">Why their best posts won</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {r.winners.map((w, i) => <li key={i}><b>@{w.handle}</b>: {w.why} {w.permalink && <a href={w.permalink} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">view</a>}</li>)}
                  </ul>
                </div>
              )}
            </div>
            {r.ourAccount && <div><h3 className="mb-1 text-sm font-semibold text-slate-900">Our account</h3><p className="text-sm text-slate-700">{r.ourAccount}</p></div>}
            <List title="Rules the planner, copywriter and designer now follow" items={r.rules} />
          </section>
        )}

        {rivals.length > 0 && (
          <section className="card space-y-2">
            <h2 className="text-lg font-semibold">Competitors&apos; top posts</h2>
            <p className="text-xs text-slate-500">Last 120 days, ranked by engagement ((likes + comments) / followers). Their reach is private.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-500"><tr><th className="py-1 pr-3">Account</th><th className="pr-3">Type</th><th className="pr-3">Date</th><th className="pr-3">Likes</th><th className="pr-3">Comments</th><th className="pr-3">Eng.</th><th>Caption</th></tr></thead>
                <tbody>
                  {rivals.map((x) => (
                    <tr key={x.id} className="border-t border-slate-100 align-top">
                      <td className="py-1.5 pr-3 font-medium">@{x.handle}</td>
                      <td className="pr-3 text-xs">{x.mediaType.toLowerCase().replace("carousel_album", "carousel")}</td>
                      <td className="whitespace-nowrap pr-3 text-xs">{fmtDate(x.postedAt)}</td>
                      <td className="pr-3">{num(x.likes)}</td>
                      <td className="pr-3">{num(x.comments)}</td>
                      <td className="pr-3">{x.engagement}%</td>
                      <td className="max-w-md text-xs text-slate-600"><a href={x.permalink} target="_blank" rel="noreferrer" className="hover:underline">{x.caption.slice(0, 160) || "(no caption)"}{x.caption.length > 160 ? "…" : ""}</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {own.length > 0 && (
          <section className="card space-y-2">
            <h2 className="text-lg font-semibold">Our recent Instagram posts</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-500"><tr><th className="py-1 pr-3">Date</th><th className="pr-3">Type</th><th className="pr-3">Reach</th><th className="pr-3">Likes</th><th className="pr-3">Comments</th><th className="pr-3">Saves</th><th>Caption</th></tr></thead>
                <tbody>
                  {own.map((x) => (
                    <tr key={x.id} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap py-1.5 pr-3 text-xs">{fmtDate(x.postedAt)}</td>
                      <td className="pr-3 text-xs">{x.mediaType.toLowerCase().replace("carousel_album", "carousel")}</td>
                      <td className="pr-3">{num(x.reach)}</td>
                      <td className="pr-3">{num(x.likes)}</td>
                      <td className="pr-3">{num(x.comments)}</td>
                      <td className="pr-3">{num(x.saves)}</td>
                      <td className="max-w-md text-xs text-slate-600"><a href={x.permalink} target="_blank" rel="noreferrer" className="hover:underline">{x.caption.slice(0, 160) || "(no caption)"}</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
