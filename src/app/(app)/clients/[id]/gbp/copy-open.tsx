"use client";

import { toast } from "@/components/shell";

/** Copy the text from the nearest textarea named `field`, then open Google in a new tab. */
export function CopyOpen({ field, href, label = "Copy & open Google" }: { field: string; href: string; label?: string }) {
  return (
    <button
      type="button"
      className="btn-secondary text-xs"
      onClick={async (e) => {
        const box = e.currentTarget.closest("form")?.querySelector<HTMLTextAreaElement>(`textarea[name="${field}"]`);
        try {
          await navigator.clipboard.writeText(box?.value ?? "");
          toast("Copied. Paste it in Google, then press Mark posted.");
        } catch {
          toast("Couldn't copy. Select the text and copy it yourself.", { tone: "err" });
        }
        window.open(href, "_blank", "noopener");
      }}
    >
      {label}
    </button>
  );
}
