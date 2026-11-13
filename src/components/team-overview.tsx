import Link from "next/link";
import { Icon } from "./icons";
import { pendingOf, type ClientWork, type MemberWork, type teamOverview } from "@/lib/team";

const ago = (d: Date | null) => {
  if (!d) return "No activity yet";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 3600) return "Active in the last hour";
  if (s < 86400) return `Active ${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  return `Last active ${days} day${days === 1 ? "" : "s"} ago`;
};
const day = (d: Date) => new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The waiting items of one client, as small chips that link to where they are done. */
function Waiting({ c }: { c: ClientWork }) {
  const chips = [
    c.failed > 0 && { href: `/clients/${c.id}/articles`, text: `${c.failed} failed to send`, tone: "bg-rose-50 text-rose-700" },
    c.keywords > 0 && { href: `/clients/${c.id}/keywords?status=PENDING`, text: plural(c.keywords, "keyword"), tone: "bg-sky-50 text-sky-700" },
    c.topics > 0 && { href: `/clients/${c.id}/topics?status=GENERATED`, text: plural(c.topics, "topic"), tone: "bg-amber-50 text-amber-700" },
    c.review > 0 && { href: `/clients/${c.id}/articles`, text: `${plural(c.review, "article")} to review`, tone: "bg-indigo-50 text-indigo-700" },
    c.toSend > 0 && { href: `/clients/${c.id}/articles`, text: `${c.toSend} to send to WordPress`, tone: "bg-emerald-50 text-emerald-700" },
    c.google > 0 && { href: `/clients/${c.id}/gbp`, text: `${plural(c.google, "Google reply", "Google replies")}/posts`, tone: "bg-slate-100 text-slate-700" },
  ].filter(Boolean) as { href: string; text: string; tone: string }[];
  if (!chips.length) return <span className="text-xs text-emerald-700">Nothing waiting</span>;
  return <span className="flex flex-wrap gap-1">{chips.map((x) => <Link key={x.text} href={x.href} className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium hover:underline ${x.tone}`}>{x.text}</Link>)}</span>;
}

function Member({ m }: { m: MemberWork }) {
  const owned = m.clients.filter((c) => c.access === "OWNER");
  const helps = m.clients.filter((c) => c.access === "EDIT");
  const missed = owned.reduce((s, c) => s + c.missed, 0);
  const pct = m.month.total + m.pending ? Math.round((m.month.total / (m.month.total + m.pending)) * 100) : 100;
  const done = [
    [m.week.keywords, "keywords approved"], [m.week.topics, "topics approved"], [m.week.articles, "articles approved"], [m.week.sent, "sent to WordPress"], [m.week.google, "Google replies/posts"],
  ].filter(([n]) => (n as number) > 0) as [number, string][];
  return (
    <section className="card flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-600 font-semibold text-white">{m.name.charAt(0).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h3 className="truncate font-semibold">{m.name}</h3>{m.role === "ADMIN" && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 uppercase">Admin</span>}</div>
          <p className="text-xs text-slate-500">{ago(m.lastActive)}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        {[["Projects", owned.length, "text-slate-900"], ["Waiting", m.pending, m.pending > 10 ? "text-amber-600" : "text-slate-900"], ["Done this week", m.week.total, "text-emerald-600"], ["Done this month", m.month.total, "text-emerald-600"]].map(([l, v, t]) => (
          <div key={l as string} className="rounded-xl bg-slate-50 p-2">
            <div className={`num text-xl font-semibold ${t}`}>{v as number}</div>
            <div className="text-[11px] leading-tight text-slate-500">{l as string}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-1 flex justify-between text-xs text-slate-500"><span>This month: done vs still waiting</span><span className="num font-medium text-slate-700">{pct}%</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1.5 text-xs text-slate-500">{done.length ? <>This week: {done.map(([n, l]) => `${n} ${l}`).join(", ")}.</> : "Nothing completed yet this week."}</p>
      </div>

      {missed > 0 && <p className="flex items-center gap-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-800"><Icon name="alert" className="h-3.5 w-3.5" />{plural(missed, "posting date")} in the last 30 days went by without a blog.</p>}

      <div>
        <div className="mb-1.5 text-xs font-medium text-slate-500">Projects and what&apos;s waiting</div>
        {owned.length === 0 ? <p className="text-sm text-slate-500">No clients assigned as owner.</p> : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {owned.map((c) => (
              <li key={c.id} className="space-y-1 px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/clients/${c.id}`} className="truncate text-sm font-medium text-slate-900 hover:text-indigo-600">{c.name}</Link>
                  <span className="shrink-0 text-[11px] text-slate-500">{c.sentMonth > 0 && <>{c.sentMonth} sent this month · </>}{c.next ? `Next post ${day(c.next)}` : "No post date"}</span>
                </div>
                <Waiting c={c} />
              </li>
            ))}
          </ul>
        )}
        {helps.length > 0 && <p className="mt-2 text-xs text-slate-500">Also helps on: {helps.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link href={`/clients/${c.id}`} className="hover:text-indigo-600">{c.name}</Link>{pendingOf(c) > 0 && ` (${pendingOf(c)} waiting)`}</span>)}</p>}
      </div>
    </section>
  );
}

export function TeamOverview({ data }: { data: Awaited<ReturnType<typeof teamOverview>> }) {
  const { members, unowned, totals } = data;
  const sorted = [...members].sort((a, b) => b.pending - a.pending || b.week.total - a.week.total);
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Team members", members.length, "users"],
          ["Active clients", totals.clients, "briefcase"],
          ["Waiting across the team", totals.pending, "inbox"],
          ["Done this week", totals.doneWeek, "check"],
          ["Blogs sent this month", totals.sentMonth, "send"],
        ].map(([l, v, i]) => (
          <div key={l as string} className="card flex items-center gap-3 !py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><Icon name={i as never} className="h-4 w-4" /></span>
            <div><div className="num text-xl font-semibold">{v as number}</div><div className="text-xs text-slate-500">{l as string}</div></div>
          </div>
        ))}
      </div>
      {(unowned.length > 0 || totals.missed > 0) && (
        <div className="mb-6 space-y-2">
          {unowned.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
              <Icon name="alert" className="h-4 w-4" /><b>{plural(unowned.length, "client")} with no owner:</b>
              <span>{unowned.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link href={`/clients/${c.id}`} className="underline">{c.name}</Link>{pendingOf(c) > 0 && ` (${pendingOf(c)} waiting)`}</span>)}</span>
              <Link href="/users" className="ml-auto text-xs font-medium underline">Assign owners on the Team page</Link>
            </p>
          )}
        </div>
      )}
      <p className="mb-3 text-sm text-slate-500">Each member&apos;s clients, what&apos;s waiting in them, and what they finished. Members with the most waiting come first. &quot;Done&quot; counts approvals, blogs sent to WordPress and Google replies or posts.</p>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{sorted.map((m) => <Member key={m.id} m={m} />)}</div>
      {members.length === 0 && <p className="card text-sm text-slate-500">No team members yet.</p>}
    </>
  );
}
