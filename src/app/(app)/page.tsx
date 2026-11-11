import Link from "next/link";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/components/ui";
import { weeklyWins } from "@/lib/stats";
import { Greeting } from "@/components/fun";
import { ReviewQueue, type QueueItem } from "@/components/review-queue";
import { ClientPulse, type Pulse } from "@/components/client-pulse";
import { Icon } from "@/components/icons";

const ago = (d: Date) => {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

const FEED: Record<string, { text: (n: number) => string; tone: string; icon: string }> = {
  "keyword.approved": { text: (n) => `approved ${n} keyword${n === 1 ? "" : "s"}`, tone: "bg-slate-100 text-slate-600", icon: "check" },
  "keyword.add": { text: (n) => `added ${n > 1 ? `${n} ` : ""}keywords`, tone: "bg-slate-100 text-slate-600", icon: "plus" },
  "topic.approved": { text: (n) => `approved ${n} topic${n === 1 ? "" : "s"}`, tone: "bg-slate-100 text-slate-600", icon: "check" },
  "topic.generate": { text: () => "generated new topics", tone: "bg-slate-100 text-slate-600", icon: "lightbulb" },
  "article.ready": { text: () => "delivered an article for review", tone: "bg-slate-100 text-slate-600", icon: "file" },
  "article.approved": { text: () => "approved an article", tone: "bg-slate-100 text-slate-600", icon: "check" },
  "article.push": { text: () => "pushed an article to WordPress", tone: "bg-emerald-50 text-emerald-600", icon: "send" },
  "article.push_failed": { text: () => "couldn't push an article to WordPress", tone: "bg-red-50 text-red-600", icon: "alert" },
  "audit.done": { text: () => "finished a site audit", tone: "bg-slate-100 text-slate-600", icon: "stethoscope" },
  "audit.email": { text: () => "emailed an audit report", tone: "bg-slate-100 text-slate-600", icon: "mail" },
  "backlinks.refresh": { text: () => "refreshed backlinks", tone: "bg-slate-100 text-slate-600", icon: "refresh" },
  "rank.up": { text: () => "climbed in Google", tone: "bg-emerald-50 text-emerald-600", icon: "trending" },
  "rank.down": { text: () => "dropped in Google", tone: "bg-red-50 text-red-600", icon: "chart" },
  "link.add": { text: () => "added an internal link in WordPress", tone: "bg-slate-100 text-slate-600", icon: "link" },
  "brand.update": { text: () => "updated a brand profile", tone: "bg-slate-100 text-slate-600", icon: "palette" },
  "gbp.reply_posted": { text: () => "replied to a Google review", tone: "bg-slate-100 text-slate-600", icon: "message" },
  "gbp.post_posted": { text: () => "posted on a Google profile", tone: "bg-slate-100 text-slate-600", icon: "pin" },
  "client.create": { text: () => "added a new client", tone: "bg-slate-100 text-slate-600", icon: "plus" },
};

export default async function Home() {
  const user = await requireUser();
  const scope = { client: clientScope(user, "edit") };
  const since12 = new Date(Date.now() - 12 * 7 * 864e5);
  const today = new Date(new Date().toISOString().slice(0, 10));

  const [kw, topics, arts, replies, gposts, toPostGoogle, counts, failedPushes, toPush, openRequests, failedIntake, wins, clients] = await Promise.all([
    db.keyword.findMany({ where: { ...scope, status: "PENDING" }, select: { id: true, keyword: true, searchVolume: true, difficulty: true, intent: true, clientId: true, client: { select: { name: true } } }, orderBy: { addedAt: "asc" }, take: 25 }),
    db.topic.findMany({ where: { ...scope, status: "GENERATED" }, select: { id: true, title: true, keyword: true, category: true, angle: true, clientId: true, client: { select: { name: true } } }, orderBy: { generatedAt: "asc" }, take: 25 }),
    db.article.findMany({ where: { ...scope, status: "READY_FOR_REVIEW" }, select: { id: true, metaTitle: true, focusKeyword: true, qualityScore: true, contentScore: true, client: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 15 }),
    db.gbpReview.findMany({ where: { ...scope, status: "DRAFTED" }, select: { id: true, author: true, rating: true, text: true, draft: true, clientId: true, client: { select: { name: true } }, profile: { select: { label: true } } }, orderBy: { reviewedAt: "asc" }, take: 15 }),
    db.gbpPost.findMany({ where: { ...scope, status: "DRAFTED" }, select: { id: true, text: true, cta: true, link: true, clientId: true, client: { select: { name: true } }, profile: { select: { label: true } } }, take: 10 }),
    Promise.all([db.gbpReview.findFirst({ where: { ...scope, status: "APPROVED" }, select: { clientId: true } }), db.gbpReview.count({ where: { ...scope, status: "APPROVED" } }), db.gbpPost.count({ where: { ...scope, status: "APPROVED" } })]),
    Promise.all([
      db.keyword.count({ where: { ...scope, status: "PENDING" } }),
      db.topic.count({ where: { ...scope, status: "GENERATED" } }),
      db.article.count({ where: { ...scope, status: "READY_FOR_REVIEW" } }),
      db.gbpReview.count({ where: { ...scope, status: "DRAFTED" } }),
      db.gbpPost.count({ where: { ...scope, status: "DRAFTED" } }),
    ]),
    db.article.findMany({ where: { ...scope, status: "PUSH_FAILED" }, select: { id: true, metaTitle: true, status: true, client: { select: { name: true } } }, take: 8 }),
    db.article.findMany({ where: { ...scope, status: "APPROVED" }, select: { id: true, metaTitle: true, status: true, client: { select: { name: true } } }, orderBy: { approvedAt: "asc" }, take: 8 }),
    user.role === "SUPER_ADMIN" ? db.accessRequest.count({ where: { status: "PENDING" } }) : Promise.resolve(0),
    user.role !== "MEMBER" ? db.formSubmission.count({ where: { processedAt: null } }) : Promise.resolve(0),
    weeklyWins(user.id),
    db.client.findMany({ where: { ...clientScope(user), status: "ACTIVE" }, select: { id: true, name: true, siteUrl: true, brandPrimaryColor: true }, orderBy: { name: "asc" }, take: 60 }),
  ]);
  const ids = clients.map((c) => c.id);
  const [weeks, crawls, slots, waitingKw, waitingTopics, waitingArts, feed] = await Promise.all([
    db.gscPageWeek.groupBy({ by: ["clientId", "weekStart"], where: { clientId: { in: ids }, weekStart: { gte: since12 } }, _sum: { clicks: true, impressions: true }, orderBy: { weekStart: "asc" } }),
    db.siteCrawl.findMany({ where: { clientId: { in: ids }, status: "DONE", score: { not: null } }, select: { clientId: true, score: true }, orderBy: { startedAt: "desc" }, distinct: ["clientId"] }),
    db.postingSlot.findMany({ where: { clientId: { in: ids }, scheduledDate: { gte: today } }, select: { clientId: true, scheduledDate: true }, orderBy: { scheduledDate: "asc" }, distinct: ["clientId"] }),
    db.keyword.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, status: "PENDING" }, _count: true }),
    db.topic.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, status: "GENERATED" }, _count: true }),
    db.article.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, status: "READY_FOR_REVIEW" }, _count: true }),
    db.activityLog.findMany({ where: { action: { in: Object.keys(FEED) }, ...(user.role === "SUPER_ADMIN" ? {} : { clientId: { in: ids } }) }, select: { id: true, action: true, after: true, at: true, clientId: true, actorTag: true, actor: { select: { name: true } } }, orderBy: { at: "desc" }, take: 7 }),
  ]);

  // Average position for the latest week, weighted by impressions.
  const lastWeek = await db.gscPageWeek.groupBy({ by: ["clientId", "weekStart"], where: { clientId: { in: ids }, weekStart: { gte: new Date(Date.now() - 14 * 864e5) } }, _sum: { impressions: true }, _avg: { position: true }, orderBy: { weekStart: "desc" } });
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const waitingBy = new Map<string, number>();
  for (const g of [...waitingKw, ...waitingTopics, ...waitingArts]) waitingBy.set(g.clientId, (waitingBy.get(g.clientId) ?? 0) + g._count);

  const pulses: Pulse[] = clients.map((c) => {
    const trend = weeks.filter((w) => w.clientId === c.id).map((w) => w._sum.clicks ?? 0);
    const pos = lastWeek.find((w) => w.clientId === c.id)?._avg.position ?? null;
    const slot = slots.find((s) => s.clientId === c.id);
    return {
      id: c.id,
      name: c.name,
      site: c.siteUrl,
      color: c.brandPrimaryColor,
      health: crawls.find((x) => x.clientId === c.id)?.score ?? null,
      clicks: trend.length ? trend[trend.length - 1] : null,
      position: pos,
      trend,
      next: slot ? new Date(slot.scheduledDate).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "No post scheduled",
      waiting: waitingBy.get(c.id) ?? 0,
    };
  });
  // Clients that need you first, then the rest by clicks.
  pulses.sort((a, b) => b.waiting - a.waiting || (b.clicks ?? -1) - (a.clicks ?? -1));

  const items: QueueItem[] = [
    ...kw.map((k) => ({
      kind: "keyword" as const,
      id: k.id,
      clientName: k.client.name,
      title: k.keyword,
      note: k.difficulty != null && k.difficulty >= 60 ? "Hard keyword. Ranking will take strong content and links." : k.searchVolume != null && k.searchVolume < 20 ? "Very few searches per month." : undefined,
      facts: [
        { label: "Volume / mo", value: k.searchVolume == null ? "—" : k.searchVolume.toLocaleString() },
        { label: "Difficulty", value: k.difficulty == null ? "—" : String(k.difficulty) },
        { label: "Intent", value: k.intent ? k.intent[0].toUpperCase() + k.intent.slice(1) : "—" },
      ],
      href: `/clients/${k.clientId}/keywords?status=PENDING`,
    })),
    ...topics.map((t) => ({
      kind: "topic" as const,
      id: t.id,
      clientName: t.client.name,
      title: t.title,
      note: t.angle ?? undefined,
      facts: [
        { label: "Focus keyword", value: t.keyword },
        ...(t.category ? [{ label: "Category", value: t.category }] : []),
      ],
      href: `/clients/${t.clientId}/topics?status=GENERATED`,
    })),
    ...arts.map((a) => ({
      kind: "article" as const,
      id: a.id,
      clientName: a.client.name,
      title: a.metaTitle,
      note: "Approving here marks it ready to push. Open it first if you want to read it.",
      facts: [
        { label: "Focus keyword", value: a.focusKeyword },
        { label: "SOP score", value: a.qualityScore == null ? "—" : String(a.qualityScore) },
        { label: "Content score", value: a.contentScore == null ? "—" : String(a.contentScore) },
      ],
      href: `/articles/${a.id}`,
    })),
    ...replies.map((r) => ({
      kind: "review" as const,
      id: r.id,
      clientName: `${r.client.name} · ${r.profile.label}`,
      title: `${"★".repeat(Math.round(r.rating ?? 0)) || "?"} from ${r.author.split(/\s+/)[0]}`,
      quote: r.text || "(rating only, no text)",
      body: r.draft ?? "",
      facts: [],
      href: `/clients/${r.clientId}/gbp#reviews`,
    })),
    ...gposts.map((p) => ({
      kind: "post" as const,
      id: p.id,
      clientName: `${p.client.name} · ${p.profile.label}`,
      title: "This week's Google post",
      body: p.text,
      facts: [{ label: "Button", value: (p.cta ?? "LEARN_MORE").replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) }, ...(p.link ? [{ label: "Links to", value: p.link.replace(/^https?:\/\/(www\.)?/, "") }] : [])],
      href: `/clients/${p.clientId}/gbp#posts`,
    })),
  ];
  const [nKw, nTopic, nArt, nRev, nPost] = counts;
  const total = nKw + nTopic + nArt + nRev + nPost;
  // Pages losing Google traffic (Refresh tab), and updated pages whose before/after result came in this week.
  const [losing, results] = await Promise.all([
    db.contentRefresh.groupBy({ by: ["clientId"], where: { ...scope, status: { in: ["OPEN", "DRAFTED"] } }, _count: true }),
    db.contentRefresh.findMany({ where: { ...scope, status: "DONE", afterAt: { gte: new Date(Date.now() - 7 * 864e5) } }, select: { clientId: true, baseClicks: true, afterClicks: true } }),
  ]);
  const nLosing = losing.reduce((a, g) => a + g._count, 0);
  const topLosing = [...losing].sort((a, b) => b._count - a._count)[0];
  const nWon = results.filter((r) => (r.afterClicks ?? 0) > (r.baseClicks ?? 0)).length;
  const [firstGoogle, okReplies, okPosts] = toPostGoogle;
  const alerts = [
    failedPushes.length > 0 && { href: `/articles/${failedPushes[0].id}`, text: `${failedPushes.length} article${failedPushes.length === 1 ? "" : "s"} failed to push to WordPress`, tone: "bg-red-50 text-red-700 border-red-200" },
    openRequests > 0 && { href: "/access", text: `${openRequests} access request${openRequests === 1 ? "" : "s"} waiting`, tone: "bg-amber-50 text-amber-700 border-amber-200" },
    okReplies + okPosts > 0 && { href: `/clients/${firstGoogle?.clientId ?? ""}/gbp`, text: `${okReplies + okPosts} approved Google repl${okReplies + okPosts === 1 ? "y or post" : "ies and posts"} to publish`, tone: "bg-indigo-50 text-indigo-700 border-indigo-200" },
    nLosing > 0 && { href: `/clients/${topLosing.clientId}/refresh`, text: `${nLosing} page${nLosing === 1 ? " is" : "s are"} losing Google traffic${losing.length > 1 ? ` across ${losing.length} clients` : ""}`, tone: "bg-amber-50 text-amber-700 border-amber-200" },
    results.length > 0 && { href: `/clients/${results[0].clientId}/refresh#done`, text: `Update results are in: ${nWon} of ${results.length} page${results.length === 1 ? "" : "s"} won traffic back`, tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    failedIntake > 0 && { href: "/intake", text: `${failedIntake} Tally submission${failedIntake === 1 ? "" : "s"} need a look`, tone: "bg-amber-50 text-amber-700 border-amber-200" },
  ].filter(Boolean) as { href: string; text: string; tone: string }[];
  const goal = 25;

  return (
    <>
      <Greeting name={user.name.split(" ")[0]} sub={total ? `${total} decision${total === 1 ? " is" : "s are"} waiting on you.` : "Nothing is waiting on you. Your clients are moving."} />

      {alerts.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {alerts.map((a) => (
            <Link key={a.href} href={a.href} className={`group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:brightness-[0.97] ${a.tone}`}>
              <Icon name="alert" className="h-4 w-4" /> {a.text} <Icon name="arrow" className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      )}

      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        <ReviewQueue items={items} counts={{ keyword: nKw, topic: nTopic, article: nArt, review: nRev, post: nPost }} streak={wins.streak} />
        <div className="card p-5">
          <h2 className="font-sans text-sm font-semibold tracking-normal">Live activity</h2>
          {feed.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Approvals, new articles and audits will show up here.</p>
          ) : (
            <ol className="mt-3.5 grid gap-3.5">
              {feed.map((f) => {
                const m = FEED[f.action];
                const n = Number((f.after as { count?: number } | null)?.count ?? 1);
                const who = f.actor?.name.split(" ")[0] ?? (f.actorTag === "n8n" ? "n8n" : f.actorTag === "tally" ? "Tally" : "Rankflow");
                return (
                  <li key={f.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-2.5 text-[13px] leading-snug">
                    <span className={`grid h-6 w-6 place-items-center rounded-md ${m.tone}`}><Icon name={m.icon} className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0">
                      <b className="font-semibold">{who}</b> {m.text(n)}
                      {f.clientId && names.get(f.clientId) && <> for <Link href={`/clients/${f.clientId}`} className="font-semibold hover:text-indigo-600">{names.get(f.clientId)}</Link></>}
                    </span>
                    <span className="num text-xs text-slate-400">{ago(f.at)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>

      {toPush.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">Approved, ready to push</h2>
          <div className="card divide-y divide-slate-100 p-0">
            {toPush.map((a) => (
              <Link key={a.id} href={`/articles/${a.id}`} className="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-slate-50">
                <span className="min-w-0 flex-1 truncate font-medium">{a.metaTitle}</span>
                <span className="hidden truncate text-slate-500 sm:block">{a.client.name}</span>
                <StatusBadge status={a.status} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Clients</h2>
          <p className="text-sm text-slate-500">Google clicks per week over the last 12 weeks. Clients that need you come first.</p>
        </div>
        <Link href="/clients" className="btn-secondary shrink-0">See all</Link>
      </div>
      <div className="stagger mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {pulses.map((c) => <ClientPulse key={c.id} c={c} />)}
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="font-sans text-sm font-semibold tracking-normal">Your week</h2>
            <span className="num text-sm text-slate-500">{wins.total} / {goal} wins</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <span className="grow-x block h-full rounded-full bg-indigo-600" style={{ width: `${Math.min(100, (wins.total / goal) * 100)}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-slate-600">
            <span className="rounded-md bg-slate-100 px-2.5 py-1">{wins.by.keywords} keywords</span>
            <span className="rounded-md bg-slate-100 px-2.5 py-1">{wins.by.topics} topics</span>
            <span className="rounded-md bg-slate-100 px-2.5 py-1">{wins.by.approved} articles</span>
            <span className="rounded-md bg-slate-100 px-2.5 py-1">{wins.by.pushed} pushed</span>
          </div>
        </div>
        <div className="card">
          <h2 className="font-sans text-sm font-semibold tracking-normal">Team this week</h2>
          {wins.leaders.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No wins yet this week. Be the first on the board.</p>
          ) : (
            <ol className="mt-3 space-y-2">
              {wins.leaders.map((l, i) => (
                <li key={l.id} className="flex items-center gap-3 text-sm">
                  <span className={`num grid h-5 w-5 place-items-center rounded text-[11px] font-medium ${i < 3 ? "ink" : "text-slate-400"}`}>{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{l.name}{l.id === user.id && <span className="ml-1 text-xs text-indigo-600">(you)</span>}</span>
                  <span className="num font-medium">{l.score}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </>
  );
}
