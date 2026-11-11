import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { SubmitButton } from "@/components/submit-button";
import { fmtDate } from "@/lib/utils";
import { directoryLinks, hoursText, type GbpAi, type GbpFinding, type GbpInfo } from "@/lib/gbp";
import { googleLinks } from "@/lib/gbp-content";
import { dataforseoConfigured } from "@/lib/dataforseo";
import { geminiConfigured } from "@/lib/gemini";
import { RefreshWhile } from "@/components/refresh-while";
import { addGbpAction, deleteGbpAction, draftPostsAction, draftRepliesAction, fetchReviewsAction, refreshGbpAction, renameGbpAction, savePostAction, saveReplyAction } from "./actions";
import { CopyOpen } from "./copy-open";

export const maxDuration = 120;

const SEV: Record<GbpFinding["severity"], string> = { error: "✕ text-red-700", warning: "! text-amber-700", info: "ⓘ text-slate-600", ok: "✓ text-emerald-700" };
const PRI: Record<string, string> = { P1: "text-red-700", P2: "text-amber-700", P3: "text-sky-700" };

export default async function GbpPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; fetching?: string; drafted?: string }> }) {
  const { id } = await params;
  const { err, fetching, drafted } = await searchParams;
  const user = await requireUser();
  const [editable, profiles, reviews, posts, reviewStats] = await Promise.all([
    canEdit(user, id),
    db.gbpProfile.findMany({ where: { clientId: id }, orderBy: { createdAt: "asc" } }),
    db.gbpReview.findMany({ where: { clientId: id, status: { in: ["NEW", "DRAFTED", "APPROVED"] } }, include: { profile: { select: { label: true, placeId: true, cid: true } } }, orderBy: { reviewedAt: "desc" }, take: 30 }),
    db.gbpPost.findMany({ where: { clientId: id }, include: { profile: { select: { label: true } } }, orderBy: { weekOf: "desc" }, take: 8 }),
    db.gbpReview.groupBy({ by: ["status"], where: { clientId: id }, _count: true }),
  ]);
  const fetchingNow = profiles.some((p) => p.reviewsTask);
  const answered = reviewStats.find((r) => r.status === "POSTED")?._count ?? 0;
  const lastFetch = profiles.map((p) => p.reviewsAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
  const STATUS: Record<string, string> = { NEW: "bg-slate-100 text-slate-600", DRAFTED: "bg-amber-50 text-amber-700", APPROVED: "bg-indigo-50 text-indigo-700", POSTED: "bg-emerald-50 text-emerald-700", SKIPPED: "bg-slate-100 text-slate-500" };
  const label: Record<string, string> = { NEW: "New", DRAFTED: "Needs review", APPROVED: "Approved, post it", POSTED: "Posted", SKIPPED: "Skipped" };
  return (
    <div className="space-y-6">
      {fetchingNow && <RefreshWhile ms={15000} />}
      {profiles.length > 0 && (
        <section id="content" className="grid scroll-mt-24 gap-4 xl:grid-cols-2">
          <div id="reviews" className="card space-y-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">Review replies</h2>
                <p className="text-sm text-slate-500">New Google reviews are fetched every week and the AI drafts a reply in the brand voice. Approve here or in the review queue on Today, then copy it into Google.{lastFetch && <> Last checked {fmtDate(lastFetch)}, {answered} answered so far.</>}{fetchingNow && <span className="ml-1 text-indigo-600">Fetching reviews…</span>}</p>
              </div>
              {editable && (
                <div className="flex gap-2">
                  <form action={fetchReviewsAction.bind(null, id)}><SubmitButton className="btn-secondary text-xs" disabled={!dataforseoConfigured() || fetchingNow}>Fetch reviews</SubmitButton></form>
                  {reviews.some((r) => r.status === "NEW") && <form action={draftRepliesAction.bind(null, id)}><SubmitButton className="btn-secondary text-xs" disabled={!geminiConfigured()}>Draft replies</SubmitButton></form>}
                </div>
              )}
            </div>
            {fetching && !fetchingNow && <p className="rounded-lg bg-indigo-50 p-2 text-sm text-indigo-800">Reviews are on the way. Drafts appear within a few minutes.</p>}
            {reviews.length === 0 ? (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{lastFetch ? "Every review has a reply. Nice." : "No reviews fetched yet. Press Fetch reviews to start."}</p>
            ) : (
              <ul className="space-y-3">
                {reviews.map((r) => {
                  const g = googleLinks(r.profile);
                  return (
                    <li key={r.id} className="rounded-xl border border-slate-200 p-3.5">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-amber-500">{"★".repeat(Math.round(r.rating ?? 0))}<span className="text-slate-300">{"★".repeat(5 - Math.round(r.rating ?? 0))}</span></span>
                        <b className="font-medium text-slate-800">{r.author}</b>
                        <span className="text-slate-400">{r.profile.label}{r.reviewedAt && ` · ${fmtDate(r.reviewedAt)}`}</span>
                        <span className={`ml-auto rounded-md px-2 py-0.5 font-medium ${STATUS[r.status]}`}>{label[r.status]}</span>
                      </div>
                      <p className="mb-2.5 line-clamp-4 border-l-2 border-slate-200 pl-3 text-sm text-slate-600 italic">{r.text || "(rating only, no text)"}</p>
                      {r.status === "NEW" ? (
                        <p className="text-xs text-slate-400">Reply not drafted yet.</p>
                      ) : (
                        <form action={saveReplyAction.bind(null, id, r.id)} className="space-y-2">
                          <textarea name="draft" defaultValue={r.draft ?? ""} rows={3} className="input text-sm" disabled={!editable} />
                          {editable && (
                            <div className="flex flex-wrap items-center gap-2">
                              {r.status === "DRAFTED" && <SubmitButton name="status" value="APPROVED" className="btn-primary text-xs">Approve</SubmitButton>}
                              <CopyOpen field="draft" href={g.reviews} />
                              <SubmitButton name="status" value="POSTED" className="btn-secondary text-xs">Mark posted</SubmitButton>
                              <SubmitButton name="status" value="SKIPPED" className="ml-auto text-xs text-slate-400 hover:text-red-600">Skip</SubmitButton>
                            </div>
                          )}
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div id="posts" className="card space-y-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">Weekly posts</h2>
                <p className="text-sm text-slate-500">Every Monday the AI drafts one update post per profile, featuring the newest blog post. Profiles that post often look active to Google and to customers.</p>
              </div>
              {editable && <form action={draftPostsAction.bind(null, id)}><SubmitButton className="btn-secondary text-xs" disabled={!geminiConfigured()}>Draft this week&apos;s post</SubmitButton></form>}
            </div>
            {drafted && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">Drafts are ready below.</p>}
            {posts.length === 0 ? (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No posts yet. The first one is drafted on the next daily run, or press the button.</p>
            ) : (
              <ul className="space-y-3">
                {posts.map((p) => (
                  <li key={p.id} className={`rounded-xl border border-slate-200 p-3.5 ${p.status === "POSTED" || p.status === "SKIPPED" ? "opacity-70" : ""}`}>
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <b className="font-medium text-slate-800">Week of {fmtDate(p.weekOf)}</b>
                      <span className="text-slate-400">{p.profile.label}</span>
                      <span className={`ml-auto rounded-md px-2 py-0.5 font-medium ${STATUS[p.status]}`}>{label[p.status]}</span>
                    </div>
                    <form action={savePostAction.bind(null, id, p.id)} className="space-y-2">
                      <textarea name="text" defaultValue={p.text} rows={5} className="input text-sm" disabled={!editable || p.status === "POSTED"} />
                      <p className="text-xs text-slate-500">Button: <b className="font-medium">{(p.cta ?? "LEARN_MORE").replace("_", " ").toLowerCase()}</b>{p.link && <> → <a href={p.link} target="_blank" rel="noreferrer" className="break-all text-indigo-600 hover:underline">{p.link}</a></>}</p>
                      {editable && p.status !== "POSTED" && (
                        <div className="flex flex-wrap items-center gap-2">
                          {p.status === "DRAFTED" && <SubmitButton name="status" value="APPROVED" className="btn-primary text-xs">Approve</SubmitButton>}
                          <CopyOpen field="text" href={googleLinks({ placeId: null, cid: null }).posts} />
                          <SubmitButton name="status" value="POSTED" className="btn-secondary text-xs">Mark posted</SubmitButton>
                          {p.status !== "SKIPPED" && <SubmitButton name="status" value="SKIPPED" className="ml-auto text-xs text-slate-400 hover:text-red-600">Skip</SubmitButton>}
                        </div>
                      )}
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-400">Google only lets approved apps post for you, so publishing is copy and paste for now: Copy &amp; open Google, choose the profile, Add update, paste, add the button link.</p>
          </div>
        </section>
      )}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Google Business Profile audit</h2>
            <p className="text-sm text-slate-500">Checks each Google Maps listing: claimed status, reviews, categories, hours, photos, description, website link and whether the name, address and phone match the website. It goes into the full audit PDF on the Site audit tab.</p>
          </div>
          {editable && profiles.length > 0 && <form action={refreshGbpAction.bind(null, id)}><SubmitButton className="btn-secondary">Re-check all profiles</SubmitButton></form>}
        </div>
        {err && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
        {editable && (
          <form action={addGbpAction.bind(null, id)} className="grid gap-2 md:grid-cols-[10rem_1fr_auto]">
            <input name="label" placeholder="Location, e.g. Oakland" className="input" />
            <input name="query" required placeholder="Google Maps link of the listing (or its CID / place ID / exact business name)" className="input" />
            <SubmitButton className="btn-primary">＋ Add profile</SubmitButton>
          </form>
        )}
        <p className="text-xs text-slate-500">To get the link: search the business on Google Maps, open the listing, click <b>Share → Copy link</b>, and paste it here. Add one per location.</p>
      </section>

      {profiles.map((p) => {
        const info = p.data as unknown as GbpInfo | null;
        const findings = (p.findings as unknown as GbpFinding[] | null) ?? [];
        const ai = p.ai as unknown as GbpAi | null;
        const issues = findings.filter((f) => f.severity !== "ok");
        return (
          <section key={p.id} className="card space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">{p.label}</h2>
              {info?.is_claimed != null && <span className={`rounded-md px-2 py-0.5 text-xs ring-1 ring-inset ${info.is_claimed ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}>{info.is_claimed ? "Claimed" : "Not claimed"}</span>}
              {info?.rating?.value != null && <span className="text-sm"><b>{info.rating.value}</b> <span className="text-slate-500">({info.rating.votes_count ?? 0} reviews)</span></span>}
              <span className="flex-1" />
              {p.fetchedAt && <span className="text-xs text-slate-400">checked {fmtDate(p.fetchedAt)}</span>}
              {editable && (
                <details className="relative text-xs">
                  <summary className="cursor-pointer text-slate-500 hover:text-slate-800">Edit</summary>
                  <div className="absolute right-0 z-10 mt-1 w-64 space-y-2 rounded-xl bg-white p-3 shadow-lg ring-1 ring-slate-200">
                    <form action={renameGbpAction.bind(null, id, p.id)} className="flex gap-1"><input name="label" defaultValue={p.label} className="input flex-1 text-xs" /><SubmitButton className="btn-secondary text-xs">Save</SubmitButton></form>
                    <form action={deleteGbpAction.bind(null, id, p.id)}><SubmitButton className="text-xs text-red-600 hover:underline">Remove this profile</SubmitButton></form>
                  </div>
                </details>
              )}
            </div>
            {p.error && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{p.error}</p>}
            {!info ? <p className="text-sm text-slate-500">No data yet.</p> : (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <table className="table text-sm">
                    <tbody>
                      {([
                        ["Business name", info.title],
                        ["Address", info.address],
                        ["Phone", info.phone],
                        ["Website", info.url ? <a key="u" href={info.url} target="_blank" rel="noreferrer" className="break-all text-indigo-600 hover:underline">{info.url}</a> : "—"],
                        ["Primary category", info.category],
                        ["Other categories", (info.additional_categories ?? []).join(", ") || "—"],
                        ["Hours", hoursText(info) || "—"],
                        ["Photos", info.total_photos ?? "—"],
                        ["Description", info.description ? `${info.description.length} characters` : "—"],
                        ["Services", (info.services ?? []).map((s) => s.title).filter(Boolean).slice(0, 12).join(", ") || "—"],
                        ["Attributes", Object.values(info.attributes?.available_attributes ?? {}).flat().slice(0, 8).join(", ").replace(/_/g, " ") || "—"],
                        ["Coordinates", info.latitude != null ? `${info.latitude}, ${info.longitude}` : "—"],
                        ["Place ID", info.place_id ?? "—"],
                        ["CID", info.cid ?? "—"],
                      ] as [string, React.ReactNode][]).map(([k, v]) => <tr key={k}><td className="w-36 text-xs font-medium text-slate-500">{k}</td><td className="text-xs">{v ?? "—"}</td></tr>)}
                    </tbody>
                  </table>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1 font-semibold">Findings</div>
                      <ul className="space-y-1.5 text-sm">
                        {findings.map((f, i) => { const [icon, cls] = SEV[f.severity].split(" "); return <li key={i} className="flex gap-2"><span className={cls}>{icon}</span><span><span className={`font-medium ${cls}`}>{f.title}</span>{f.detail && <span className="block text-xs text-slate-500">{f.detail}</span>}</span></li>; })}
                      </ul>
                      {issues.length === 0 && <p className="text-sm text-emerald-700">No problems found.</p>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">{directoryLinks(info).map((l) => <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="rounded-md bg-slate-50 px-2.5 py-1 text-indigo-700 ring-1 ring-slate-200 hover:bg-indigo-50">{l.label} ↗</a>)}</div>
                    {(info.people_also_search?.length ?? 0) > 0 && (
                      <div className="text-xs"><div className="mb-1 font-medium text-slate-600">Competitors Google shows next to this listing</div>
                        <ul className="space-y-0.5">{info.people_also_search!.slice(0, 6).map((c, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{c.title}</span><span className="shrink-0 text-slate-500">{c.rating?.value ?? "—"} · {c.rating?.votes_count ?? 0} reviews</span></li>)}</ul>
                      </div>
                    )}
                  </div>
                </div>
                {ai && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl bg-red-50/60 p-3 text-sm ring-1 ring-red-100"><div className="mb-1 font-semibold text-red-800">Issue description</div>{ai.description.map((d, i) => <p key={i} className="mb-1">{d}</p>)}</div>
                    <div className="rounded-xl bg-emerald-50/60 p-3 text-sm ring-1 ring-emerald-100"><div className="mb-1 font-semibold text-emerald-800">How to fix</div>{ai.fix.map((d, i) => <p key={i} className="mb-1">{d}</p>)}</div>
                    {ai.actions.length > 0 && (
                      <table className="table text-sm md:col-span-2">
                        <thead><tr><th className="w-16">Priority</th><th>Action</th><th>Benefit</th></tr></thead>
                        <tbody>{ai.actions.map((a, i) => <tr key={i}><td className={`font-semibold ${PRI[a.priority]}`}>{a.priority}</td><td>{a.action}</td><td className="text-slate-500">{a.benefit}</td></tr>)}</tbody>
                      </table>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
