"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { FORMATS, FORMAT_HELP, PICTURE_FORMATS, kindLabel } from "@/lib/social/formats";
import { anotherLookAction, approvePostAction, deletePostAction, regenerateImageAction, regenerateTextAction, rejectPostAction, relayoutAction, restorePostAction, savePostAction, unapprovePostAction } from "./actions";

export type CardPost = {
  id: string;
  project: string;
  platforms: string[];
  service: string;
  angle: string;
  idea: string;
  why: string;
  score: number;
  stage: string;
  stageError: string | null;
  status: string;
  rejectionReason: string | null;
  hooks: string[];
  captionFacebook: string;
  captionInstagram: string;
  captionLinkedin: string;
  firstComment: string;
  headlineTop: string;
  headlineMain: string;
  headlineBottom: string;
  /** concept, photo, type, note, list or versus */
  format: string;
  /** The text on the image for text-first formats */
  designText: string;
  hasMedia: boolean;
  /** The image model's prompt (editable) */
  imageBrief: string;
  /** static, carousel or video */
  kind: string;
  pillar: string;
  /** Carousel slides after the cover, as text (see parseSlides) */
  slidesText: string;
  endText: string;
  /** The Reel's lines, one per line */
  scenesText: string;
  slideCount: number;
  hasVideo: boolean;
  hasImage: boolean;
  hasPhoto: boolean;
  imageVersion: number;
  when: string;
  whenLabel: string;
  results: Record<string, { id?: string; url?: string; error?: string }> | null;
};

const CAP: [keyof CardPost & `caption${string}`, string, number][] = [
  ["captionInstagram", "instagram", 2200],
  ["captionFacebook", "facebook", 3000],
  ["captionLinkedin", "linkedin", 3000],
];
const NAME: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };

function swapFirstLine(text: string, hook: string) {
  const i = text.indexOf("\n");
  return i < 0 ? hook : hook + text.slice(i);
}

export function PostCard({ p }: { p: CardPost }) {
  const [caps, setCaps] = useState({ captionInstagram: p.captionInstagram, captionFacebook: p.captionFacebook, captionLinkedin: p.captionLinkedin });
  const [panel, setPanel] = useState<"" | "reject" | "text" | "image">("");
  const busy = p.stage !== "ready" && p.stage !== "error";
  const locked = p.status === "PUBLISHED" || p.status === "PUBLISHING";
  const tone =
    p.status === "APPROVED" ? "border-emerald-300" : p.status === "REJECTED" ? "border-red-200 opacity-75" : p.status === "PUBLISHED" ? "border-sky-200" : p.status === "FAILED" ? "border-red-300" : "border-slate-200";
  return (
    <article className={`card grid gap-5 border-2 p-4 lg:grid-cols-[360px_1fr] ${tone}`}>
      <div className="space-y-2">
        <div className={`relative overflow-hidden rounded-xl bg-slate-100 ${p.kind === "video" && p.hasVideo ? "aspect-[9/16]" : "aspect-[4/5]"}`}>
          {p.kind === "video" && p.hasVideo ? (
            <video key={p.imageVersion} src={`/api/social/video/${p.id}.mp4?v=${p.imageVersion}`} poster={`/api/social/image/${p.id}.jpg?v=${p.imageVersion}`} controls muted loop playsInline className="h-full w-full bg-black object-contain" />
          ) : p.hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/social/image/${p.id}.jpg?v=${p.imageVersion}`} alt={p.headlineMain} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
              {p.stage === "error" ? <span className="text-red-700">Couldn&apos;t make this one: {p.stageError}</span> : p.stage === "idea" || p.stage === "writing" ? "Writing captions…" : "Designing the image…"}
            </div>
          )}
          {busy && p.hasImage && <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-sm font-medium">{p.kind === "video" ? "Making the Reel…" : "Updating…"}</div>}
        </div>
        {p.kind === "carousel" && p.slideCount > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {Array.from({ length: p.slideCount }, (_, i) => (
              <a key={i} href={`/api/social/image/${p.id}-${i + 2}.jpg?v=${p.imageVersion}`} target="_blank" rel="noreferrer" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/social/image/${p.id}-${i + 2}.jpg?v=${p.imageVersion}&w=240`} alt={`Slide ${i + 2}`} className="h-28 w-[90px] rounded-md object-cover ring-1 ring-slate-200" />
              </a>
            ))}
          </div>
        )}
        {!locked && p.hasImage && (
          <>
            <div className="flex flex-wrap gap-1">
              {FORMATS.map(([k, label]) => (
                <form key={k} action={relayoutAction.bind(null, p.id, k)}>
                  <SubmitButton
                    title={k === "photo" ? "Uses a real photo from this project's library (or an AI photo if the library is empty)" : k === "concept" ? "One striking AI visual with a few words" : undefined}
                    className={`rounded-md px-2 py-1 text-xs ${p.format === k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    {label}
                  </SubmitButton>
                </form>
              ))}
            </div>
            <div className="flex gap-2">
              <form action={anotherLookAction.bind(null, p.id)} className="flex-1">
                <SubmitButton className="btn-secondary w-full text-xs">Another look</SubmitButton>
              </form>
              {PICTURE_FORMATS.includes(p.format) && (
                <button type="button" onClick={() => setPanel(panel === "image" ? "" : "image")} className="btn-secondary flex-1 text-xs">
                  {p.format === "concept" ? "Image prompt" : "Change photo"}
                </button>
              )}
            </div>
          </>
        )}
        {panel === "image" && PICTURE_FORMATS.includes(p.format) && (
          <div className="space-y-3 rounded-md bg-slate-50 p-3">
            {p.format === "photo" && (
              <form action={regenerateImageAction.bind(null, p.id)}>
                <input type="hidden" name="mode" value="library" />
                <SubmitButton className="btn-secondary w-full text-xs">Next photo from the library</SubmitButton>
              </form>
            )}
            <form action={regenerateImageAction.bind(null, p.id)} className="space-y-2">
              <input type="hidden" name="mode" value="ai" />
              <label className="block">
                <span className="label">Image prompt (sent to Google Imagen exactly as written)</span>
                <textarea name="prompt" rows={6} defaultValue={p.imageBrief} className="input text-sm leading-5" placeholder="Describe one real scene that shows the topic: subject, setting, camera, light. e.g. Close-up of a shop owner's phone showing a Google Maps listing, inside a Dubai bakery, morning light, realistic photo." />
              </label>
              <SubmitButton className="btn-secondary w-full text-xs">New image from this prompt</SubmitButton>
              <p className="text-xs text-slate-500">Takes about 20 seconds and costs about $0.04. &quot;No text in the image&quot; and the project&apos;s style notes are added automatically. Your changes teach the AI for next time.</p>
            </form>
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <b className="text-sm text-slate-900">{p.project}</b>
          <span className={`rounded-md px-2 py-0.5 font-semibold ${p.kind === "video" ? "bg-fuchsia-100 text-fuchsia-800" : p.kind === "carousel" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>{kindLabel(p.kind)}</span>
          {p.pillar && <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-800">{p.pillar}</span>}
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">{p.service}</span>
          <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-indigo-700">{p.angle}</span>
          <span className="text-slate-400">score {p.score}/10</span>
          <span className="ml-auto font-medium text-slate-600">{p.whenLabel}</span>
        </div>
        <p className="text-sm font-medium text-slate-800">{p.idea}</p>
        {p.why && <p className="-mt-2 text-xs text-slate-500">{p.why}</p>}

        {p.status === "REJECTED" && (
          <div className="flex items-center gap-3 rounded-lg bg-red-50 p-2 text-sm text-red-800">
            <span className="flex-1">Rejected: {p.rejectionReason}</span>
            <form action={restorePostAction.bind(null, p.id)}><SubmitButton className="text-xs underline">Restore</SubmitButton></form>
          </div>
        )}
        {(p.status === "PUBLISHED" || p.status === "FAILED" || p.status === "PUBLISHING") && p.results && (
          <ul className="space-y-1 rounded-lg bg-slate-50 p-2 text-xs">
            {Object.entries(p.results).map(([k, r]) => (
              <li key={k}>
                <b>{NAME[k] ?? k}:</b> {r.url ? <a className="text-indigo-600 hover:underline" href={r.url} target="_blank" rel="noreferrer">view post</a> : r.error ? <span className="text-red-700">{r.error}</span> : r.id ? "posted" : "waiting"}
              </li>
            ))}
          </ul>
        )}

        {p.stage === "ready" || p.stage === "error" || p.captionInstagram || p.captionFacebook || p.captionLinkedin ? (
          <form className="space-y-3">
            {p.hooks.length > 0 && !locked && (
              <div>
                <div className="label">Pick the opening line (puts it at the top of every caption)</div>
                <div className="flex flex-col gap-1">
                  {p.hooks.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setCaps((c) => ({ captionInstagram: c.captionInstagram && swapFirstLine(c.captionInstagram, h), captionFacebook: c.captionFacebook && swapFirstLine(c.captionFacebook, h), captionLinkedin: c.captionLinkedin && swapFirstLine(c.captionLinkedin, h) }))}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-left text-sm hover:border-indigo-300 hover:bg-indigo-50"
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {PICTURE_FORMATS.includes(p.format) ? (
              <div>
                <div className="label">Words on the image ({p.format === "concept" ? "small / big" : "small / big / small"}). Keep it short. *Stars* highlight words.</div>
                <div className={`grid gap-2 ${p.format === "concept" ? "sm:grid-cols-[1fr_2fr]" : "sm:grid-cols-3"}`}>
                  <input name="headlineTop" defaultValue={p.headlineTop} className="input text-sm" disabled={locked} />
                  <input name="headlineMain" defaultValue={p.headlineMain} className="input text-sm font-semibold" disabled={locked} />
                  {p.format !== "concept" && <input name="headlineBottom" defaultValue={p.headlineBottom} className="input text-sm" disabled={locked} />}
                </div>
              </div>
            ) : (
              <label className="block">
                <span className="label">Text on the image</span>
                <textarea name="designText" defaultValue={p.designText} rows={p.format === "type" ? 3 : 6} className="input text-sm leading-5" disabled={locked} />
                <span className="mt-1 block text-xs text-slate-500">{FORMAT_HELP[p.format]}</span>
              </label>
            )}
            {p.kind === "carousel" && (
              <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
                <label className="block">
                  <span className="label">Slides after the cover</span>
                  <textarea name="slidesText" defaultValue={p.slidesText} rows={8} className="input text-sm leading-5" disabled={locked} />
                  <span className="mt-1 block text-xs text-slate-500">One slide per block: the title on the first line, its text below. Leave a blank line between slides.</span>
                </label>
                <label className="block">
                  <span className="label">Last slide</span>
                  <textarea name="endText" defaultValue={p.endText} rows={3} className="input text-sm leading-5" disabled={locked} />
                </label>
              </div>
            )}
            {p.kind === "video" && (
              <label className="block">
                <span className="label">Words in the Reel</span>
                <textarea name="scenesText" defaultValue={p.scenesText} rows={3} className="input text-sm leading-5" disabled={locked} />
                <span className="mt-1 block text-xs text-slate-500">One line per scene. They appear one after another over the visual (about 3 seconds each).</span>
              </label>
            )}
            <div className="grid gap-3 xl:grid-cols-2">
              {CAP.filter(([, plat]) => p.platforms.includes(plat)).map(([key, plat, max]) => (
                <label key={key} className="block">
                  <span className="label flex justify-between">
                    {NAME[plat]} <span className={caps[key].length > max ? "text-red-600" : "text-slate-400"}>{caps[key].length}</span>
                  </span>
                  <textarea name={key} value={caps[key]} onChange={(e) => setCaps((c) => ({ ...c, [key]: e.target.value }))} rows={9} className="input text-sm leading-5" disabled={locked} />
                </label>
              ))}
              {p.platforms.includes("linkedin") && (
                <label className="block">
                  <span className="label">LinkedIn first comment (the link goes here)</span>
                  <textarea name="firstComment" defaultValue={p.firstComment} rows={2} className="input text-sm" disabled={locked} />
                </label>
              )}
            </div>
            <label className="block max-w-xs">
              <span className="label">Goes out (project&apos;s local time)</span>
              <input type="datetime-local" name="scheduledAt" defaultValue={p.when} className="input text-sm" disabled={locked} />
            </label>
            {!locked && (
              <div className="flex flex-wrap items-center gap-2">
                {p.status === "APPROVED" ? (
                  <>
                    <span className="text-sm font-medium text-emerald-700">✓ Approved</span>
                    <SubmitButton formAction={savePostAction.bind(null, p.id)} className="btn-secondary text-xs">Save changes</SubmitButton>
                    <SubmitButton formAction={unapprovePostAction.bind(null, p.id)} className="text-xs text-slate-500 hover:underline">Undo approval</SubmitButton>
                  </>
                ) : p.status === "REJECTED" ? null : (
                  <>
                    <SubmitButton formAction={approvePostAction.bind(null, p.id)} className="btn-primary" disabled={!p.hasImage || busy}>Approve</SubmitButton>
                    <SubmitButton formAction={savePostAction.bind(null, p.id)} className="btn-secondary text-xs">Save</SubmitButton>
                  </>
                )}
                <button type="button" onClick={() => setPanel(panel === "text" ? "" : "text")} className="btn-secondary text-xs">↻ New captions</button>
                {p.status !== "REJECTED" && <button type="button" onClick={() => setPanel(panel === "reject" ? "" : "reject")} className="btn-danger text-xs">Reject</button>}
                <SubmitButton formAction={deletePostAction.bind(null, p.id)} onClick={(e) => { if (!confirm("Delete this post for good?")) e.preventDefault(); }} className="ml-auto text-xs text-slate-400 hover:text-red-600">Delete</SubmitButton>
              </div>
            )}
          </form>
        ) : (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Captions are being written…</p>
        )}

        {panel === "text" && (
          <form action={regenerateTextAction.bind(null, p.id)} className="space-y-2 rounded-xl bg-slate-50 p-3">
            <textarea name="note" rows={2} className="input text-sm" placeholder="Optional: what to change (e.g. shorter, less salesy, open with a story, mention free audit)" />
            <SubmitButton className="btn-primary text-xs">Write new captions</SubmitButton>
            <span className="ml-2 text-xs text-slate-500">Keeps the picture. Your note teaches the AI.</span>
          </form>
        )}
        {panel === "reject" && (
          <form action={rejectPostAction.bind(null, p.id)} className="space-y-2 rounded-xl bg-red-50 p-3">
            <textarea name="reason" required rows={2} className="input text-sm" placeholder="Why? (e.g. too generic, we don't offer this, wrong tone, image looks fake). The AI learns from this." />
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="replace" value="1" className="btn-primary text-xs">Reject and make a new one</SubmitButton>
              <SubmitButton name="replace" value="0" className="btn-danger text-xs">Just reject</SubmitButton>
            </div>
          </form>
        )}
      </div>
    </article>
  );
}
