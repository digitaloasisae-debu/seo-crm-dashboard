import { db } from "@/lib/db";
import { SubmitButton } from "@/components/submit-button";
import { addLinksAction, dismissLinkAction, suggestLinksAction } from "./link-actions";

/** Internal links: older pages that should point to this article, added through WordPress. */
export async function InternalLinks({ articleId, editable, ai, hasCred, note }: { articleId: string; editable: boolean; ai: boolean; hasCred: boolean; note?: string }) {
  const links = await db.internalLink.findMany({ where: { articleId, status: { not: "DISMISSED" } }, orderBy: { createdAt: "asc" } });
  const open = links.filter((l) => l.status !== "ADDED");
  return (
    <section id="links" className="card scroll-mt-20 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-sans text-sm font-semibold tracking-normal">🔗 Internal links to this article</h3>
        {editable && ai && <form action={suggestLinksAction.bind(null, articleId)}><SubmitButton className="text-xs text-indigo-600 hover:underline">{links.length ? "↻ Suggest again" : "✨ Suggest links"}</SubmitButton></form>}
      </div>
      {note && <p className={`rounded-lg p-2 text-xs ${note.startsWith("err:") ? "bg-red-50 text-red-700" : "bg-indigo-50 text-indigo-800"}`}>{note.startsWith("err:") ? note.slice(4) : note}</p>}
      {links.length === 0 ? (
        <p className="text-sm text-slate-500">When this article is approved, AI finds older pages that should link to it. You can also ask now.</p>
      ) : (
        <form action={addLinksAction.bind(null, articleId)} className="space-y-2">
          {links.map((l) => (
            <div key={l.id} className="flex items-start gap-2.5 rounded-xl border border-slate-100 p-2.5 text-sm">
              {l.status === "ADDED" ? <span className="mt-0.5 text-emerald-600">✓</span> : <input type="checkbox" name="ids" value={l.id} defaultChecked={l.status === "SUGGESTED"} disabled={!editable || !hasCred} className="mt-1" />}
              <div className="min-w-0 flex-1">
                <a href={l.sourceUrl} target="_blank" rel="noreferrer" className="block truncate font-medium text-indigo-600 hover:underline">{l.sourceUrl.replace(/^https?:\/\/[^/]+/, "") || "/"}</a>
                <div className="text-xs text-slate-600">Anchor: <mark className="rounded bg-amber-50 px-1 text-amber-800">{l.anchor}</mark></div>
                {l.reason && <div className="text-xs text-slate-400">{l.reason}</div>}
                {l.status === "FAILED" && l.error && <div className="text-xs text-red-600">{l.error}</div>}
                {l.status === "ADDED" && <div className="text-xs text-emerald-700">Added in WordPress</div>}
              </div>
              {editable && l.status !== "ADDED" && <button formAction={dismissLinkAction.bind(null, articleId, l.id)} className="cursor-pointer text-xs text-slate-400 hover:text-red-600">✕</button>}
            </div>
          ))}
          {editable && open.length > 0 && (
            hasCred ? <SubmitButton className="btn-primary w-full">Add selected links in WordPress</SubmitButton> : <p className="text-xs text-amber-700">Save this client&apos;s WordPress login to add links automatically.</p>
          )}
          <p className="text-xs text-slate-400">Links are added only once this article is live, so readers never hit a broken link.</p>
        </form>
      )}
    </section>
  );
}
