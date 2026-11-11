"use client";

import { useEffect, useRef, useState } from "react";

/** Number that counts up from 0 when it appears. */
export function CountUp({ value, className = "" }: { value: number; className?: string }) {
  const [n, setN] = useState(0);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || value === 0) { setN(value); return; }
    done.current = true;
    const start = performance.now(), dur = Math.min(1200, 400 + value * 40);
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{n}</span>;
}

const LINES = {
  morning: ["Fresh day, fresh rankings.", "Coffee in hand? Let's climb.", "Early bird gets the #1 spot."],
  afternoon: ["Keep the momentum going.", "Halfway there. Let's ship something.", "Small approvals, big rankings."],
  evening: ["One more push before you log off?", "Great work today.", "Wrap it up like a pro."],
};

/** Greets by the viewer's local time, with a waving hand. */
export function Greeting({ name, sub }: { name: string; sub?: string }) {
  const [part, setPart] = useState<keyof typeof LINES>("morning");
  const [line, setLine] = useState("");
  useEffect(() => {
    const h = new Date().getHours();
    const p = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
    setPart(p);
    setLine(LINES[p][new Date().getDate() % LINES[p].length]);
  }, []);
  return (
    <div className="mb-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 md:text-[28px]">Good {part}, {name}</h1>
      <p className="mt-1.5 min-h-5 text-sm text-slate-500">{sub ?? (line && <span className="animate-fade-in">{line}</span>)}</p>
    </div>
  );
}
