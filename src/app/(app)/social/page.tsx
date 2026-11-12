import { superAdminOnly } from "./guard";
import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { geminiConfigured } from "@/lib/gemini";
import { socialBacklog } from "@/lib/social/work";
import { monthKey, monthLabel, nextMonthKey } from "@/lib/social/schedule";
import { deleteUnapprovedAction, generateMonthAction, retryFailedAction } from "./actions";
import { ConfirmButton } from "@/components/confirm-button";
import { PostCard } from "./post-card";
import { SocialWorker } from "./worker";
import { POST_SELECT, toCard } from "./data";

export const maxDuration = 300;

const FILTERS: [string, string][] = [["review", "To review"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]];

export default async function SocialReviewPage({ searchParams }: { searchParams: Promise<{ month?: string; project?: string; show?: string; err?: string; planned?: string }> }) {
  await superAdminOnly();
  const sp = await searchParams;
  const now = new Date();
  const thisMonth = monthKey(now, "Asia/Dubai");
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : thisMonth;
  const show = FILTERS.some(([k]) => k === sp.show) ? sp.show! : "review";
  const projects = await db.socialProject.findMany({ include: { client: { select: { name: true } } }, orderBy: { client: { name: "asc" } } });
  const statusWhere = show === "review" ? { status: { in: ["DRAFT" as const, "FAILED" as const] } } : show === "approved" ? { status: "APPROVED" as const } : show === "rejected" ? { status: "REJECTED" as const } : {};
  const projectIds = sp.project ? [sp.project] : projects.map((p) => p.id);
  const [rows, counts, backlog, months] = await Promise.all([
    db.socialPost.findMany({ where: { month, projectId: { in: projectIds }, ...statusWhere }, select: POST_SELECT, orderBy: { scheduledAt: "asc" } }),
    db.socialPost.groupBy({ by: ["projectId", "status"], where: { month }, _count: true }),
    socialBacklog(),
    db.socialPost.findMany({ distinct: ["month"], select: { month: true }, orderBy: { month: "desc" }, take: 12 }),
  ]);
  // Which posts have an image / photo, without loading the bytes.
  const flags = rows.length
    ? await db.$queryRaw<{ id: string; has_image: boolean; has_photo: boolean }[]>`SELECT id, image IS NOT NULL AS has_image, photo IS NOT NULL AS has_photo FROM "SocialPost" WHERE id = ANY(${rows.map((r) => r.id)})`
    : [];
  const flag = new Map(flags.map((f) => [f.id, f]));
  const byId = new Map(projects.map((p) => [p.id, p]));
  const count = (pid: string, s: string) => counts.find((c) => c.projectId === pid && c.status === s)?._count ?? 0;
  const pickedProject = sp.project ? byId.get(sp.project) : undefined;
  const unapproved = counts.filter((c) => (!pickedProject || c.projectId === pickedProject.id) && ["DRAFT", "REJECTED", "FAILED"].includes(c.status)).reduce((n, c) => n + c._count, 0);
  const monthOptions = [...new Set([thisMonth, nextMonthKey(thisMonth), ...months.map((m) => m.month)])].sort();
  const q = (o: Record<string, string | undefined>) => {
    const u = new URLSearchParams({ month, show, ...(sp.project ? { project: sp.project } : {}), ...o } as Record<string, string>);
    for (const [k, v] of [...u.entries()]) if (!v) u.delete(k);
    return `/social?${u}`;
  };

  return (
    <>
      <PageHeader title="Social Studio" subtitle={`Posts for your own social accounts. Nothing goes out until you approve it. ${monthLabel(month)}.`} />
      {!geminiConfigured() && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Needs GEMINI_API_KEY in Vercel.</p>}
      {sp.err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{sp.err}</p>}
      {sp.planned && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{Number(sp.planned) ? `${sp.planned} post ideas planned. Captions and images are being made now.` : "Every project already has its posts for this month."}</p>}
      <SocialWorker toWrite={backlog.toWrite} toDraw={backlog.toDraw} />
      {backlog.failed > 0 && (
        <form action={retryFailedAction} className="flex items-center gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <span className="flex-1">{backlog.failed} draft{backlog.failed > 1 ? "s" : ""} failed 3 times (see the message on the card).</span>
          <SubmitButton className="btn-secondary text-xs">Try again</SubmitButton>
        </form>
      )}

      {projects.length === 0 ? (
        <Empty>
          No social projects yet. <Link className="text-indigo-600" href="/social/projects/new">Add your first account</Link>.
        </Empty>
      ) : (
        <>
          <section className="card space-y-3">
            <form action={generateMonthAction} className="flex flex-wrap items-end gap-3">
              <label>
                <span className="label">Month</span>
                <select name="month" defaultValue={month === thisMonth ? nextMonthKey(thisMonth) : month} className="input">
                  {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
              </label>
              <fieldset className="flex flex-wrap gap-3 pb-2 text-sm">
                {projects.filter((p) => p.active).map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5"><input type="checkbox" name="project" value={p.id} defaultChecked /> {p.client.name} <span className="text-xs text-slate-400">({p.postsPerMonth})</span></label>
                ))}
              </fieldset>
              <SubmitButton className="btn-primary" disabled={!geminiConfigured()}>Generate the whole month</SubmitButton>
            </form>
            <p className="text-xs text-slate-500">Plans every post for the month at once, from each project&apos;s targeted services only. Months that already have posts are only topped up. Planning takes about a minute; then captions and images are made one by one.</p>
          </section>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-slate-500">Showing:</span>
            {monthOptions.map((m) => <Link key={m} href={q({ month: m })} className={`rounded-md px-3 py-1 text-xs ${m === month ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{monthLabel(m)}</Link>)}
            {unapproved > 0 && (
              <form action={deleteUnapprovedAction} className="ml-auto">
                <input type="hidden" name="month" value={month} />
                {pickedProject && <input type="hidden" name="project" value={pickedProject.id} />}
                <ConfirmButton
                  message={`Delete ${unapproved} unapproved post${unapproved > 1 ? "s" : ""} in ${monthLabel(month)}${pickedProject ? ` for ${pickedProject.client.name}` : ""}? Approved and live posts are kept. This can't be undone.`}
                  className="text-xs text-slate-500 hover:text-red-600"
                >
                  Delete {unapproved} unapproved{pickedProject ? ` (${pickedProject.client.name})` : ""}
                </ConfirmButton>
              </form>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {projects.map((p) => (
              <Link key={p.id} href={q({ project: sp.project === p.id ? undefined : p.id })} className={`card card-hover p-3 ${sp.project === p.id ? "ring-2 ring-indigo-400" : ""} ${p.active ? "" : "opacity-60"}`}>
                <div className="font-semibold">{p.client.name}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                  <span>{count(p.id, "DRAFT")} to review</span>
                  <span className="text-emerald-700">{count(p.id, "APPROVED")} approved</span>
                  <span className="text-sky-700">{count(p.id, "PUBLISHED")} live</span>
                  <span className="text-red-600">{count(p.id, "REJECTED")} rejected</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">{p.platforms.join(" · ")} · {p.postsPerMonth}/month</div>
              </Link>
            ))}
          </div>
          <div className="flex gap-1 text-sm">
            {FILTERS.map(([k, label]) => <Link key={k} href={q({ show: k })} className={`rounded-lg px-3 py-1.5 ${show === k ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>)}
          </div>
          {rows.length === 0 ? (
            <Empty>{show === "review" ? "Nothing waiting for review in this month." : "No posts here."}</Empty>
          ) : (
            <div className="space-y-4">
              {rows.map((r) => {
                const f = flag.get(r.id);
                return <PostCard key={`${r.id}-${r.updatedAt.getTime()}`} p={toCard({ ...r, hasImage: !!f?.has_image, hasPhoto: !!f?.has_photo }, byId.get(r.projectId)!)} />;
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
