"use client";

import { Icon } from "@/components/icons";

/** Opens the browser's print dialog, where "Save as PDF" makes a PDF of the report. */
export function PrintButton({ label = "Save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn-secondary inline-flex items-center gap-1.5 print:hidden">
      <Icon name="download" className="h-4 w-4" /> {label}
    </button>
  );
}
