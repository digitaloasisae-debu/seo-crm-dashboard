import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Badge, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { runN8nAction } from "../../../actions";

export default async function ClientOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [client, editable, slots, activity, counts] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id }, include: { assignments: { include: { user: true } }, credentials: true } }),
    canEdit(user, id),
    db.postingSlot.findMany({ where: { clientId: id, scheduledDate: { gte: new Date(Date.now() - 31 * 864e5) } }, orderBy: { scheduledDate: "asc" }, include: { article: { select: { metaTitle: true, status: true } } }, take: 12 }),
    db.activityLog.findMany({ where: { clientId: id }, orderBy: { at: "desc" }, take: 15, include: { actor: { select: { name: true } } } }),
    db.keyword.groupBy({ by: ["status", "used"], where: { clientId: id }, _count: true }),
  ]);
  const wp = client.credentials.find((c) => c.kind === "WORDPRESS");
  const approvedUnused = counts.find((c) => c.status === "APPROVED" && !c.used)?._count ?? 0;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className="card">
          <h2 className="mb-3 font-semibold">Profile</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <div><dt className="text-slate-500">Business type</dt><dd>{client.businessType || "—"}</dd></div>
            <div><dt className="text-slate-500">Market</dt><dd>{[client.primaryCity, client.targetCountry].filter(Boolean).join(", ") || "—"}</dd></div>
            <div className="md:col-span-2"><dt className="text-slate-500">Services</dt><dd>{client.servicesOffered.join(", ") || "—"}</dd></div>
            <div className="md:col-span-2"><dt className="text-slate-500">Competitors</dt><dd>{client.competitors.join(", ") || "—"}</dd></div>
            <div><dt className="text-slate-500">CTA</dt><dd>{client.ctaText || "—"} {client.ctaLink && <span className="text-slate-400">→ {client.ctaLink}</span>}</dd></div>
            <div><dt className="text-slate-500">Posts per month</dt><dd>{client.postsPerMonth}</dd></div>
            <div><dt className="text-slate-500">Images</dt><dd>{client.imageRequired ? `Yes${client.imageStyle ? `, ${client.imageStyle}` : ""}` : "No"}</dd></div>
            <div><dt className="text-slate-500">WordPress</dt><dd>{wp ? (wp.lastVerifiedAt ? <Badge color="green">connected {fmtDate(wp.lastVerifiedAt)}</Badge> : wp.lastError ? <Badge color="red">error</Badge> : <Badge color="yellow">saved, not tested</Badge>) : <Badge color="red">missing</Badge>}</dd></div>
            <div><dt className="text-slate-500">Keyword form link</dt><dd className="font-mono text-xs break-all">{process.env.TALLY_KEYWORDS_FORM_URL ? <a className="text-indigo-600 hover:underline" href={`${process.env.TALLY_KEYWORDS_FORM_URL}?client_slug=${client.slug}`} target="_blank" rel="noreferrer">{`${process.env.TALLY_KEYWORDS_FORM_URL}?client_slug=${client.slug}`}</a> : `?client_slug=${client.slug}`}</dd></div>
            <div><dt className="text-slate-500">Approved unused keywords</dt><dd>{approvedUnused}</dd></div>
          </dl>
        </section>

        <section className="card">
          <h2 className="mb-3 font-semibold">Posting schedule</h2>
          {slots.length === 0 ? <p className="text-sm text-slate-500">No posting dates. Set posts per month in Settings.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {slots.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2">
                  <span>{fmtDate(s.scheduledDate)}</span>
                  {s.article ? <span className="flex items-center gap-2"><span className="max-w-xs truncate">{s.article.metaTitle}</span><StatusBadge status={s.article.status} /></span> : <span className="text-slate-400">open</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="mb-3 font-semibold">Recent activity</h2>
          <ul className="space-y-1 text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className="w-24 shrink-0 text-slate-400">{fmtDate(a.at)}</span>
                <span className="w-28 shrink-0 font-medium">{a.actor?.name ?? a.actorTag ?? "system"}</span>
                <span className="text-slate-600">{a.action.replace(/[._]/g, " ")}</span>
              </li>
            ))}
            {activity.length === 0 && <li className="text-slate-500">Nothing yet.</li>}
          </ul>
        </section>
      </div>

      <div className="space-y-6">
        <section className="card">
          <h2 className="mb-3 font-semibold">Team</h2>
          <ul className="space-y-2 text-sm">
            {client.assignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <span>{a.user.name}</span>
                <span className="flex items-center gap-2"><StatusBadge status={a.access} />{a.expiresAt && <span className="text-xs text-slate-400">until {fmtDate(a.expiresAt)}</span>}</span>
              </li>
            ))}
            {client.assignments.length === 0 && <li className="text-slate-500">No one assigned.</li>}
          </ul>
        </section>

        {editable && (
          <section className="card space-y-2">
            <h2 className="mb-1 font-semibold">Run n8n now</h2>
            <p className="text-xs text-slate-500">Starts the workflow for this client only, outside the monthly schedule.</p>
            <form action={runN8nAction.bind(null, id, "WF1")}><button className="btn-secondary w-full">Generate topics (WF1)</button></form>
            <form action={runN8nAction.bind(null, id, "WF2")}><button className="btn-secondary w-full">Write approved topics (WF2)</button></form>
          </section>
        )}
      </div>
    </div>
  );
}
