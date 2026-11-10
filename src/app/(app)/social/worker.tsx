"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { workAction } from "./actions";

/** While drafts are still being written or designed, keeps the work going and refreshes the page. */
export function SocialWorker({ toWrite, toDraw }: { toWrite: number; toDraw: number }) {
  const router = useRouter();
  const [left, setLeft] = useState({ toWrite, toDraw });
  const [err, setErr] = useState("");
  const running = useRef(false);
  useEffect(() => {
    if (running.current || toWrite + toDraw === 0) return;
    running.current = true;
    let stop = false;
    (async () => {
      for (let i = 0; i < 40 && !stop; i++) {
        try {
          const r = await workAction();
          setLeft({ toWrite: r.toWrite, toDraw: r.toDraw });
          router.refresh();
          if (r.toWrite + r.toDraw === 0) break;
          if (r.written + r.drawn === 0) await new Promise((res) => setTimeout(res, 15000));
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
          await new Promise((res) => setTimeout(res, 20000));
        }
      }
      running.current = false;
    })();
    return () => { stop = true; };
  }, [toWrite, toDraw, router]);
  if (left.toWrite + left.toDraw === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900">
      <span className="h-2 w-2 animate-ping rounded-full bg-indigo-500" />
      <span>
        Making drafts: {left.toWrite > 0 && <>{left.toWrite} waiting for captions, </>}{left.toDraw} waiting for images. Keep this page open to speed it up; otherwise n8n carries on every 15 minutes.
        {err && <span className="block text-xs text-red-700">{err}</span>}
      </span>
    </div>
  );
}
