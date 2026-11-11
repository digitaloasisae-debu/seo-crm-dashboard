"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { approvePostAction, deletePostAction, regenerateImageAction, regenerateTextAction, rejectPostAction, relayoutAction, restorePostAction, savePostAction, unapprovePostAction } from "./actions";

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
  imageLayout: string;
  hasImage: boolean;
  hasPhoto: boolean;
  imageVersion: number;
  when: string;
  whenLabel: string;
  results: Record<string, { id?: string; url?: string; error?: string }> | null;
};

const LAYOUTS: [string, string][] = [["banner", "Banner"], ["split", "Split"], ["photo", "Photo"], ["statement", "Statement"]];
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
        <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-slate-100">
          {p.hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/social/image/${p.id}.jpg?v=${p.imageVersion}`} alt={p.headlineMain} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
              {p.stage === "error" ? <span className="text-red-700">Couldn&apos;t make this one: {p.stageError}</span> : p.stage === "idea" || p.stage === "writing" ? "Writing captions…" : "Designing the image…"}
            </div>
          )}
          {busy && p.hasImage && <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-sm font-medium">Updating…</div>}
        </div>
        {!locked && p.hasPhoto && (
          <div className="flex flex-wrap gap-1">
            {LAYOUTS.map(([k, label]) => (
              <form key={k} action={relayoutAction.bind(null, p.id, k)}>
                <SubmitButton className={`rounded-md px-2 py-1 text-xs ${p.imageLayout === k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}</SubmitButton>
              </form>
            ))}
          </div>
        )}
        {!locked && (
          <button type="button" onClick={() => setPanel(panel === "image" ? "" : "image")} className="btn-secondary w-full text-xs">
            New image
          </button>
        )}
        {panel === "image" && (
          <form action={regenerateImageAction.bind(null, p.id)} className="space-y-2 rounded-xl bg-slate-50 p-3">
            <textarea name="note" rows={2} className="input text-sm" placeholder="Optional: what to change (e.g. show a real shop floor, no people in suits, warmer light)" />
            <SubmitButton className="btn-primary w-full text-xs">Make a new image</SubmitButton>
            <p className="text-xs text-slate-500">Takes about 30 seconds. Your note also teaches the AI for next time.</p>
          </form>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <b className="text-sm text-slate-900">{p.project}</b>
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
            <div>
              <div className="label">Image headline (small / big / small)</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input name="headlineTop" defaultValue={p.headlineTop} className="input text-sm" disabled={locked} />
                <input name="headlineMain" defaultValue={p.headlineMain} className="input text-sm font-semibold" disabled={locked} />
                <input name="headlineBottom" defaultValue={p.headlineBottom} className="input text-sm" disabled={locked} />
              </div>
            </div>
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
                {p.status === "REJECTED" && <SubmitButton formAction={deletePostAction.bind(null, p.id)} className="ml-auto text-xs text-slate-400 hover:text-red-600">Delete</SubmitButton>}
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
            <span className="ml-2 text-xs text-slate-500">Keeps the photo. Your note teaches the AI.</span>
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
