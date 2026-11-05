"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes the page every few seconds while something runs in the background. */
export function RefreshWhile({ ms = 5000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}
