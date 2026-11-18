import { superAdminOnly } from "./guard";
import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { geminiConfigured } from "@/lib/gemini";
import { socialBacklog } from "@/lib/social/work";
import { monthKey, monthLabel, nextMonthKey, prevMonthKey } from "@/lib/social/schedule";
import { deleteFailedAction, deleteUnapprovedAction, generateMonthAction, retryFailedAction } from "./actions";
import { ConfirmButton } from "@/components/confirm-button";
import { PostCard } from "./post-card";
import { SocialWorker } from "./worker";
import { PlanProgress } from "./plan-progress";
import { POST_SELECT, toCard } from "./data";

export const maxDuration = 300;

/**
 * Review page. Hamza (2026-11-17): picking a project, then a month, then a filter was confusing, and
 * forgetting the project mixed every account together. Now there is always exactly ONE project open
 * (the one with the most to review, unless he picks another), and it opens on the month that needs him.
 */
const FILTERS = [
  { key: "review", label: "To review", statuses: ["DRAFT", "FAILED"] },
  { key: "approved", label: "Approved", statuses: ["APPROVED"] },
  { key: "live", label: "Live", statuses: ["PUBLISHED"] },
  { key: "rejected", label: "Rejected", statuses: ["REJECTED"] },
  { key: "all", label: "All", statuses: [] as string[] },
] as const;

export default async function SocialReviewPage({ searchParams }: { searchParams: Promise<{ month?: string; project?: string; show?: string; err?: string; planned?: string }> }) {
  await superAdminOnly();
  const sp = await searchParams;
  const thisMonth = monthKey(new Date(), "Asia/Dubai");
  const projects = await db.socialProject.findMany({ include: { client: { select: { name: true } } }, orderBy: { client: { name: "asc" } } });

  if (projects.length === 0) {
    return (
      <>
        <PageHeader title="Social Studio" subtitle="Posts for your own social accounts. Nothing goes out until you approve it." />
        <Empty>
          No social projects yet. <Link className="text-indigo-600" href="/social/projects/new">Add your first account</Link>.
        </Empty>
      </>
    );
  }

  // Posts waiting for review, per project and per project+month.
  const waiting = await db.socialPost.groupBy({ by: ["projectId", "month"], where: { status: { in: ["DRAFT", "FAILED"] } }, _count: true });
  const waitingFor = (pid: string) => waiting.filter((w) => w.projectId === pid).reduce((n, w) => n + w._count, 0);

  const project =
    projects.find((p) => p.id === sp.project) ??
    [...projects].sort((a, b) => waitingFor(b.id) - waitingFor(a.id) || Number(b.active) - Number(a.active))[0];
  const firstWaitingMonth = waiting.filter((w) => w.projectId === project.id).map((w) => w.month).sort()[0];
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : firstWaitingMonth ?? thisMonth;
  const filter = FILTERS.find((f) => f.key === sp.show) ?? FILTERS[0];

  const [rows, counts, backlog, monthRows] = await Promise.all([
    db.socialPost.findMany({
      where: { month, projectId: project.id, ...(filter.statuses.length ? { status: { in: [...filter.statuses] as ("DRAFT" | "FAILED" | "APPROVED" | "PUBLISHED" | "REJECTED")[] } } : {}) },
      select: POST_SELECT,
      orderBy: { scheduledAt: "asc" },
    }),
    db.socialPost.groupBy({ by: ["status"], where: { month, projectId: project.id }, _count: true }),
    socialBacklog(),
    db.socialPost.findMany({ where: { projectId: project.id }, distinct: ["month"], select: { month: true }, orderBy: { month: "desc" }, take: 12 }),
  ]);
  const flags = rows.length
    ? await db.$queryRaw<{ id: string; has_image: boolean; has_photo: boolean; slides: number; has_video: boolean }[]>`SELECT id, image IS NOT NULL AS has_image, photo IS NOT NULL AS has_photo, coalesce(array_length(slides, 1), 0)::int AS slides, video IS NOT NULL AS has_video FROM "SocialPost" WHERE id = ANY(${rows.map((r) => r.id)})`
    : [];
  const failedPosts = backlog.failed
    ? await db.socialPost.findMany({ where: { stage: "error" }, select: { id: true, projectId: true, month: true, idea: true, stageError: true, project: { select: { client: { select: { name: true } } } } }, orderBy: { scheduledAt: "asc" }, take: 10 })
    : [];
  const flag = new Map(flags.map((f) => [f.id, f]));

  const countOf = (statuses: readonly string[]) => counts.filter((c) => !statuses.length || statuses.includes(c.status)).reduce((n, c) => n + c._count, 0);
  const unapproved = countOf(["DRAFT", "REJECTED", "FAILED"]);
  const months = [...new Set([thisMonth, nextMonthKey(thisMonth), month, ...monthRows.map((m) => m.month)])].sort();
  const waitingIn = (m: string) => waiting.find((w) => w.projectId === project.id && w.month === m)?._count ?? 0;
  const href = (o: { project?: string; month?: string; show?: string }) => {
    const u = new URLSearchParams();
    u.set("project", o.project ?? project.id);
    // Switching project starts on that project's own month that needs review.
    if (!o.project) u.set("month", o.month ?? month);
    if (o.show) u.set("show", o.show);
    else if (!o.project) u.set("show", filter.key);
    return `/social?${u}`;
  };
  const name = project.client.name;

  return (
    <>
      <PageHeader title="Social Studio" subtitle="Pick an account, then review its posts. Nothing goes out until you approve it." />
      {!geminiConfigured() && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Needs GEMINI_API_KEY in Vercel.</p>}
      {sp.err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{sp.err}</p>}
      {sp.planned && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{Number(sp.planned) ? `${sp.planned} post ideas planned. Captions and images are being made now.` : "This month already has its posts."}</p>}
      <SocialWorker toWrite={backlog.toWrite} toDraw={backlog.toDraw} />
      {failedPosts.length > 0 && (
        <div className="space-y-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex-1">{failedPosts.length} draft{failedPosts.length > 1 ? "s" : ""} couldn&apos;t be made after 3 tries. Try again, or delete {failedPosts.length > 1 ? "them" : "it"} if you don&apos;t need {failedPosts.length > 1 ? "them" : "it"}.</span>
            <form action={retryFailedAction}><SubmitButton className="btn-secondary text-xs">Try again</SubmitButton></form>
            <form action={deleteFailedAction}>
              <ConfirmButton message={`Delete the ${failedPosts.length} failed draft${failedPosts.length > 1 ? "s" : ""}? Approved and live posts are never touched.`} className="btn-secondary text-xs">Delete</ConfirmButton>
            </form>
          </div>
          <ul className="space-y-1 text-xs">
            {failedPosts.map((f) => (
              <li key={f.id}>
                <Link className="font-medium underline" href={`/social?project=${f.projectId}&month=${f.month}&show=all#post-${f.id}`}>{f.project.client.name} · {monthLabel(f.month)}</Link>
                {" "}· {f.idea.slice(0, 90)}{f.stageError ? <span className="opacity-75"> ({f.stageError.slice(0, 120)})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 1. Account: always exactly one open. */}
      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">1 · Account</div>
        <div className="flex flex-wrap gap-2">
          {projects.map((p) => {
            const n = waitingFor(p.id);
            const on = p.id === project.id;
            return (
              <Link
                key={p.id}
                href={href({ project: p.id })}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${on ? "border-indigo-600 bg-indigo-600 text-white shadow" : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300"} ${p.active ? "" : "opacity-60"}`}
              >
                {p.client.name}
                {n > 0 && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${on ? "bg-white/25 text-white" : "bg-amber-400 text-slate-900"}`}>{n}</span>}
              </Link>
            );
          })}
        </div>
      </section>

      {/* 2. Month for this account. */}
      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">2 · Month</div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ month: prevMonthKey(month) })} className="btn-secondary px-3 text-sm" aria-label="Previous month">‹</Link>
          {months.map((m) => {
            const n = waitingIn(m);
            return (
              <Link key={m} href={href({ month: m })} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${m === month ? "bg-slate-900 font-semibold text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                {monthLabel(m)}
                {n > 0 && <span className={`rounded-full px-1.5 text-[11px] font-bold ${m === month ? "bg-white/25" : "bg-amber-400 text-slate-900"}`}>{n}</span>}
              </Link>
            );
          })}
          <Link href={href({ month: nextMonthKey(month) })} className="btn-secondary px-3 text-sm" aria-label="Next month">›</Link>
        </div>
      </section>

      {/* 3. What you're looking at, in one line, plus the filters. */}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-lg font-semibold">{name}</h2>
          <span className="text-slate-500">· {monthLabel(month)}</span>
          <span className="text-xs text-slate-400">{project.platforms.join(" · ")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          {FILTERS.map((f) => (
            <Link key={f.key} href={href({ show: f.key })} className={`rounded-lg px-3 py-1.5 ${filter.key === f.key ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {f.label} <span className="opacity-70">{countOf(f.statuses)}</span>
            </Link>
          ))}
          {unapproved > 0 && (
            <form action={deleteUnapprovedAction} className="ml-auto">
              <input type="hidden" name="month" value={month} />
              <input type="hidden" name="project" value={project.id} />
              <ConfirmButton
                message={`Delete ${unapproved} unapproved post${unapproved > 1 ? "s" : ""} for ${name} in ${monthLabel(month)}? Approved and live posts are kept. This can't be undone.`}
                className="text-xs text-slate-500 hover:text-red-600"
              >
                Delete {unapproved} unapproved
              </ConfirmButton>
            </form>
          )}
        </div>
      </section>

      {countOf([]) === 0 ? (
        <form action={generateMonthAction} className="card flex flex-wrap items-center gap-3 border-dashed">
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="project" value={project.id} />
          <span className="flex-1 text-sm text-slate-600">No posts planned for {name} in {monthLabel(month)} yet.</span>
          <SubmitButton className="btn-primary" disabled={!geminiConfigured() || !project.active}>Plan {monthLabel(month)} for {name}</SubmitButton>
          <PlanProgress />
        </form>
      ) : rows.length === 0 ? (
        <Empty>{filter.key === "review" ? `Nothing left to review for ${name} in ${monthLabel(month)}.` : "No posts here."}</Empty>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const f = flag.get(r.id);
            return <PostCard key={`${r.id}-${r.updatedAt.getTime()}`} p={toCard({ ...r, hasImage: !!f?.has_image, hasPhoto: !!f?.has_photo, slideCount: f?.slides ?? 0, hasVideo: !!f?.has_video }, project)} />;
          })}
        </div>
      )}

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">Plan a whole month for several accounts</summary>
        <form action={generateMonthAction} className="mt-3 flex flex-wrap items-end gap-3">
          <label>
            <span className="label">Month</span>
            <select name="month" defaultValue={month} className="input">
              {[...new Set([...months, nextMonthKey(months[months.length - 1])])].map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
          <fieldset className="flex flex-wrap gap-3 pb-2 text-sm">
            {projects.filter((p) => p.active).map((p) => (
              <label key={p.id} className="flex items-center gap-1.5"><input type="checkbox" name="project" value={p.id} defaultChecked={p.id === project.id} /> {p.client.name}</label>
            ))}
          </fieldset>
          <SubmitButton className="btn-primary" disabled={!geminiConfigured()}>Plan the month</SubmitButton>
          <PlanProgress />
        </form>
        <p className="mt-2 text-xs text-slate-500">Each week Monday to Saturday gets 1 carousel, 2 Reels and 2 images from each account&apos;s targeted services, with holidays and events on their day. Days that already have a post are kept. Planning takes about a minute; captions and images are then made one by one.</p>
      </details>
    </>
  );
}
