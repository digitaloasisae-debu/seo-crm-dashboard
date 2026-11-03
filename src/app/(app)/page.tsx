import Link from "next/link";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { weeklyWins } from "@/lib/stats";
import { Greeting } from "@/components/fun";
import { ConfettiOnce } from "@/components/celebrate";
import { ScoreRing } from "@/components/ui";

export default async function Home() {
  const user = await requireUser();
  const scope = { client: clientScope(user, "edit") };

  const [pendingKeywords, topicsToReview, articlesToReview, failedPushes, openRequests, failedIntake, articles] = await Promise.all([
    db.keyword.count({ where: { ...scope, status: "PENDING" } }),
    db.topic.count({ where: { ...scope, status: "GENERATED" } }),
    db.article.count({ where: { ...scope, status: { in: ["READY_FOR_REVIEW", "APPROVED"] } } }),
    db.article.count({ where: { ...scope, status: "PUSH_FAILED" } }),
    user.role === "SUPER_ADMIN" ? db.accessRequest.count({ where: { status: "PENDING" } }) : Promise.resolve(0),
    user.role !== "MEMBER" ? db.formSubmission.count({ where: { processedAt: null } }) : Promise.resolve(0),
    db.article.findMany({
      where: { ...scope, status: { in: ["READY_FOR_REVIEW", "APPROVED", "PUSH_FAILED"] } },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
  ]);
  const wins = await weeklyWins(user.id);
  const waiting = pendingKeywords + topicsToReview + articlesToReview + failedPushes;
  const goal = 25;
  const pct = Math.min(100, Math.round((wins.total / goal) * 100));
  const cheer =
    wins.total === 0 ? "Your first approval this week starts the streak 🌱" :
    pct >= 100 ? "Weekly goal smashed! You're a ranking machine 🏆" :
    pct >= 60 ? "So close to your weekly goal. Keep going! 💪" :
    "Nice start. Every approval moves a client up Google 📈";
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <>
      <Greeting name={user.name.split(" ")[0]} />

      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        <div className="card relative overflow-hidden lg:col-span-2">
          <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-gradient-to-br from-indigo-400/20 to-fuchsia-400/20 blur-2xl" />
          <div className="relative flex flex-wrap items-center gap-6">
            <div className="relative">
              <ScoreRing score={pct} size={112} color="#7C3AED" suffix="%" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Your week</div>
              <div className="mt-1 text-2xl font-bold tracking-tight">{wins.total} <span className="text-base font-medium text-slate-400">/ {goal} wins</span></div>
              <p className="mt-1 text-sm text-slate-600">{cheer}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700">🏷️ {wins.by.keywords} keywords</span>
                <span className="rounded-full bg-violet-50 px-2.5 py-1 font-medium text-violet-700">💡 {wins.by.topics} topics</span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">✅ {wins.by.approved} articles</span>
                <span className="rounded-full bg-fuchsia-50 px-2.5 py-1 font-medium text-fuchsia-700">🚀 {wins.by.pushed} pushed</span>
              </div>
            </div>
            <div className="flex flex-col items-center rounded-2xl bg-gradient-to-b from-amber-50 to-orange-50 px-5 py-3 ring-1 ring-amber-200/60">
              <span className={`text-3xl ${wins.streak > 0 ? "flicker" : "opacity-40 grayscale"}`}>🔥</span>
              <span className="mt-1 text-xl font-bold text-amber-700 tabular-nums">{wins.streak}</span>
              <span className="text-[11px] font-medium text-amber-700/70">day streak</span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Team this week</div>
            <span className="text-lg">🏆</span>
          </div>
          {wins.leaders.length === 0 ? (
            <p className="text-sm text-slate-500">No wins yet this week. Be the first on the board!</p>
          ) : (
            <ol className="stagger space-y-2.5">
              {wins.leaders.map((l, i) => (
                <li key={l.id} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${l.id === user.id ? "bg-indigo-50/70 ring-1 ring-indigo-100" : ""}`}>
                  <span className="w-6 text-center text-base">{medals[i] ?? <span className="text-xs font-semibold text-slate-400">{i + 1}</span>}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{l.name}{l.id === user.id && <span className="ml-1 text-xs text-indigo-500">(you)</span>}</span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <span className="grow-x block h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" style={{ width: `${Math.max(6, (l.score / wins.leaders[0].score) * 100)}%`, animationDelay: `${i * 90}ms` }} />
                    </span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-slate-700">{l.score}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <h2 className="mb-3 text-lg font-semibold">Waiting on you</h2>
      <div className="stagger mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Keywords to approve" value={pendingKeywords} icon="tag" />
        <Stat label="Topics to review" value={topicsToReview} icon="lightbulb" />
        <Stat label="Articles to review or push" value={articlesToReview} icon="file" />
        <Stat label="Failed pushes" value={failedPushes} icon="alert" alert />
        {user.role === "SUPER_ADMIN" && <Stat label="Access requests" value={openRequests} icon="key" href="/access" />}
        {user.role !== "MEMBER" && <Stat label="Intake errors" value={failedIntake} icon="zap" alert href="/intake" />}
      </div>

      <h2 className="mb-3 text-lg font-semibold">Articles</h2>
      {articles.length === 0 ? (
        waiting === 0 ? (
          <div className="card relative flex flex-col items-center overflow-hidden py-10 text-center">
            <ConfettiOnce />
            <span className="twinkle absolute top-8 left-[22%] text-xl">✨</span>
            <span className="twinkle absolute top-16 right-[24%] text-lg [animation-delay:0.7s]">⭐</span>
            <span className="twinkle absolute bottom-10 left-[30%] text-base [animation-delay:1.3s]">✨</span>
            <div className="bob mb-3 text-6xl">🏆</div>
            <h3 className="text-xl font-bold tracking-tight">All caught up!</h3>
            <p className="mt-1 max-w-sm text-sm text-slate-500">Nothing is waiting on you right now. Your clients are in good hands. Go grab a coffee ☕</p>
          </div>
        ) : (
          <Empty>No articles are waiting on you. Check the keywords and topics above.</Empty>
        )
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr><th>Article</th><th>Client</th><th>Status</th><th>Arrived</th></tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id}>
                  <td><Link className="text-indigo-600 hover:underline" href={`/articles/${a.id}`}>{a.metaTitle}</Link></td>
                  <td>{a.client.name}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td>{fmtDate(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
