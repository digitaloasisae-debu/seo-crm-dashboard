"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadMediaAction } from "../../../actions";

/** Resize a photo in the browser (longest side 1600px, JPEG) so uploads stay small. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Could not read the photo"))), "image/jpeg", 0.85));
}

export function PhotoUploader({ projectId }: { projectId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [state, setState] = useState<{ done: number; total: number; errors: string[] } | null>(null);
  const busy = state && state.done < state.total;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    const errors: string[] = [];
    setState({ done: 0, total: list.length, errors });
    for (let i = 0; i < list.length; i++) {
      try {
        const fd = new FormData();
        fd.append("photo", await shrink(list[i]), "photo.jpg");
        const r = await uploadMediaAction(projectId, fd);
        if (!r.ok) errors.push(`${list[i].name}: ${r.error}`);
      } catch (e) {
        errors.push(`${list[i].name}: ${e instanceof Error ? e.message : "failed"}`);
      }
      setState({ done: i + 1, total: list.length, errors: [...errors] });
    }
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <label className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-300 p-6 text-center text-sm text-slate-600 hover:border-slate-400 ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        <span className="font-medium text-slate-800">{busy ? `Uploading ${state!.done + 1} of ${state!.total}…` : "Add photos"}</span>
        <span className="mt-1 text-xs">Pick as many as you like. Team, office, real work, events, screenshots of results.</span>
      </label>
      {state && !busy && <p className="text-xs text-slate-500">{state.total - state.errors.length} added. The AI is describing them now; refresh in a minute to see the descriptions.</p>}
      {state?.errors.map((e) => <p key={e} className="text-xs text-red-700">{e}</p>)}
    </div>
  );
}
