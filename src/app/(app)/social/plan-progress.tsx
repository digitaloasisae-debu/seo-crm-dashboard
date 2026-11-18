"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

const STEPS = [
  [0, "Reading the account's services and what worked before"],
  [8, "Checking holidays and events in the month"],
  [18, "Choosing a topic, post type and day for every post"],
  [45, "Saving the plan"],
] as const;

/** Shown inside a "Plan the month" form while planning runs, so it's clear something is happening. */
export function PlanProgress() {
  const { pending } = useFormStatus();
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!pending) return setSecs(0);
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);
  if (!pending) return null;
  const step = [...STEPS].reverse().find(([at]) => secs >= at)![1];
  return (
    <div className="flex w-full items-center gap-3 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900" aria-live="polite">
      <span className="h-2 w-2 animate-ping rounded-full bg-indigo-500" />
      <span>
        <b>Planning the month</b> · {step}… <span className="num opacity-70">{secs}s</span>
        <span className="block text-xs opacity-80">This takes about a minute. Then the posts appear here, with a live count of captions and images still being made.</span>
      </span>
    </div>
  );
}
