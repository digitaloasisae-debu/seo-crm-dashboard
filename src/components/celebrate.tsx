"use client";

import { useEffect } from "react";

const COLORS = ["#6366F1", "#8B5CF6", "#D946EF", "#F59E0B", "#10B981", "#38BDF8", "#F472B6"];
const CHEERS: Record<string, string[]> = {
  approved: ["Nice! ✨", "Approved! 🎉", "On a roll! 🚀", "Great call 👌", "Boom! 💥"],
  pushed: ["Shipped to WordPress! 🚀", "Draft is live! 🎉", "Another one out the door ✨"],
};

/** Fires a confetti burst from the button. Exported so other client components can celebrate too. */
export function burst(x: number, y: number, count = 70) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999";
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const parts = Array.from({ length: count }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const v = 6 + Math.random() * 7;
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, w: 5 + Math.random() * 5, h: 3 + Math.random() * 4, c: COLORS[(Math.random() * COLORS.length) | 0], round: Math.random() < 0.3 };
  });
  let t = 0;
  const tick = () => {
    t++;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.28; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - t / 90); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.5, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < 90) requestAnimationFrame(tick); else canvas.remove();
  };
  requestAnimationFrame(tick);
}

function toast(text: string, x: number, y: number) {
  const el = document.createElement("div");
  el.textContent = text;
  el.className = "cheer-toast";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

/** Listens for submits from buttons marked data-celebrate and throws confetti + a little cheer. */
export function Celebrate() {
  useEffect(() => {
    const onSubmit = (e: SubmitEvent) => {
      const btn = e.submitter as HTMLElement | null;
      const kind = btn?.dataset.celebrate;
      if (!btn || !kind) return;
      // Bulk forms: only celebrate when something is actually selected.
      const form = e.target as HTMLFormElement;
      const boxes = form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      if (boxes.length && ![...boxes].some((b) => b.checked)) return;
      const r = btn.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      burst(x, y, kind === "pushed" ? 120 : 70);
      const list = CHEERS[kind] ?? CHEERS.approved;
      toast(list[(Math.random() * list.length) | 0], x, r.top);
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);
  return null;
}

/** Fires confetti once when it mounts (used for "all caught up"). */
export function ConfettiOnce() {
  useEffect(() => {
    const key = `cheer-${new Date().toDateString()}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch {}
    const id = setTimeout(() => burst(innerWidth / 2, innerHeight * 0.45, 110), 500);
    return () => clearTimeout(id);
  }, []);
  return null;
}
