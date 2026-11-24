import { superAdminOnly } from "../../guard";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { fmtDate } from "@/lib/utils";
import { learnStyleAction, redraftCardAction, redrawUnapprovedAction, relearnAction, saveBrainAction, saveCardAction, saveProjectAction } from "../../actions";
import sharp from "sharp";
import { ProjectFields } from "../fields";
import { ProjectTabs } from "./tabs";

export const maxDuration = 120;

const KIND: Record<string, string> = { reject: "Rejected", edit: "Edited", regenerate_text: "New captions", regenerate_image: "New image", approve: "Approved" };

export default async function SocialProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; saved?: string; created?: string }> }) {
  await superAdminOnly();
  const { id } = await params;
  const sp = await searchParams;
  const p = await db.socialProject.findUnique({
    where: { id },
    include: { client: { select: { targetCountry: true, name: true, siteUrl: true, logoUrl: true, brandPrimaryColor: true, brandAccentColor: true, brandSecondaryColor: true } }, serviceCards: true, feedback: { orderBy: { createdAt: "desc" }, take: 30, include: { post: { select: { idea: true } } } } },
  });
  if (!p) notFound();
  const thumbs = await Promise.all(p.styleRefs.map((b) => sharp(Buffer.from(b)).resize({ width: 220 }).jpeg({ quality: 70 }).toBuffer().then((x) => `data:image/jpeg;base64,${x.toString("base64")}`).catch(() => "")));
  return (
    <>
      <PageHeader title={p.client.name} subtitle={p.client.siteUrl} />
      <ProjectTabs id={p.id} active="settings" />
      {sp.err && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{sp.err}</p>}
      {sp.saved && <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Saved.</p>}
      {sp.created && <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Project added. Service cards are being written from the website; refresh in a minute.</p>}
      <div className="space-y-6">
        <form action={saveProjectAction.bind(null, p.id)} className="card space-y-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <ProjectFields p={p} country={p.client.targetCountry} />
          <p className="text-xs text-slate-500">
            Brand colours and logo come from the client settings: {p.client.logoUrl ? "logo set" : "no logo yet (the name is shown instead)"}, colours {[p.client.brandPrimaryColor, p.client.brandSecondaryColor, p.client.brandAccentColor].filter(Boolean).join(", ") || "not set (default blue)"}.
          </p>
          <SubmitButton className="btn-primary">Save settings</SubmitButton>
        </form>

        <section id="style" className="card scroll-mt-24 space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Your page&apos;s style</h2>
            <p className="text-sm text-slate-500">
              {p.ownStyle ? "On: new images copy the look of this account's own best posts; only the topic and title change." : "Off. Tick \"Copy my page's style\" in Settings to use it."}
              {p.styleAt && <> Last studied {fmtDate(p.styleAt)}.</>}
            </p>
          </div>
          {p.styleError && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{p.styleError}</p>}
          {thumbs.some(Boolean) && (
            <div className="flex flex-wrap gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {thumbs.filter(Boolean).map((t, i) => <img key={i} src={t} alt={`Style reference ${i + 1}`} className="h-36 w-auto rounded-lg ring-1 ring-slate-200" />)}
            </div>
          )}
          {p.styleNotes && <details><summary className="text-sm text-slate-600">What the AI saw</summary><pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-700">{p.styleNotes}</pre></details>}
          <form action={learnStyleAction.bind(null, p.id)} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="label">Optional: upload your best posts instead (up to 15 images)</span>
              <input type="file" name="refs" accept="image/*" multiple className="text-xs" />
            </label>
            <SubmitButton className="btn-secondary text-xs">{p.styleAt ? "Study again" : "Study my best posts"}</SubmitButton>
          </form>
          <p className="text-xs text-slate-500">With no upload, it reads the top posts of the Facebook Page (and linked Instagram) set in Settings. Takes about a minute.</p>
          {p.ownStyle && p.styleRefs.length > 0 && (
            <form action={redrawUnapprovedAction.bind(null, p.id)}><SubmitButton className="btn-primary text-xs">Remake images of posts waiting for review in this style</SubmitButton></form>
          )}
        </section>

        <section id="brain" className="card scroll-mt-24 space-y-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1">
              <h2 className="text-lg font-semibold">Learning agent</h2>
              <p className="text-sm text-slate-500">Rules this account has learned from your rejections, edits and regenerate notes. Every new idea, caption and image follows them. Updated automatically after each piece of feedback{p.brainUpdatedAt && <>, last on {fmtDate(p.brainUpdatedAt)}</>}. You can edit them too.</p>
            </div>
            <form action={relearnAction.bind(null, p.id)}><SubmitButton className="btn-secondary text-xs">Re-learn now</SubmitButton></form>
          </div>
          <form action={saveBrainAction.bind(null, p.id)} className="space-y-2">
            <textarea name="brain" rows={8} defaultValue={p.brain} className="input font-mono text-xs leading-5" placeholder="Nothing learned yet. Reject or edit a few posts and rules appear here." />
            <SubmitButton className="btn-secondary text-xs">Save rules</SubmitButton>
          </form>
          {p.feedback.length > 0 && (
            <details>
              <summary className="text-sm text-slate-600">What it learned from ({p.feedback.length} recent)</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {p.feedback.map((f) => (
                  <li key={f.id} className="border-l-2 border-slate-200 pl-2">
                    <b>{KIND[f.kind] ?? f.kind}</b> {f.note && <>“{f.note}”</>} <span className="text-slate-400">{f.post?.idea && `· ${f.post.idea.slice(0, 90)}`} · {fmtDate(f.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section id="cards" className="scroll-mt-24 space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Service cards</h2>
            <p className="text-sm text-slate-500">What the AI knows about each targeted service. Ideas and captions only use facts from here, so add real results, prices or offers you want mentioned.</p>
          </div>
          {p.services.map((s) => {
            const c = p.serviceCards.find((x) => x.service === s);
            return (
              <div key={s} className="card space-y-2">
                <div className="flex items-center gap-3">
                  <b className="flex-1">{s}</b>
                  <form action={redraftCardAction.bind(null, p.id, s)}><SubmitButton className="btn-secondary text-xs">Rewrite from website</SubmitButton></form>
                </div>
                <form action={saveCardAction.bind(null, p.id, s)} className="space-y-2">
                  <label className="block">
                    <span className="label">Service page (every caption links here; empty = found automatically, else the home page)</span>
                    <input name="url" type="url" defaultValue={c?.url ?? ""} placeholder={`${p.client.siteUrl.replace(/\/+$/, "")}/...`} className="input text-sm" />
                  </label>
                  <textarea name="card" rows={10} defaultValue={c?.card ?? ""} className="input text-sm leading-5" placeholder="Not written yet. Press Rewrite from website, or type the facts yourself." />
                  <SubmitButton className="btn-secondary text-xs">Save card</SubmitButton>
                </form>
              </div>
            );
          })}
        </section>
      </div>
    </>
  );
}
