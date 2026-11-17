import { BRAND } from "@/lib/brand";

/**
 * Logo mark ("Search Page"): a magnifying glass whose lens holds a blog page,
 * with the top line and handle in gold (Plum + Gold) for the #1 result. Blog content that gets found on Google.
 */
export function LogoMark({ size = 36, animated = false, className = "" }: { size?: number; animated?: boolean; className?: string }) {
  const a = (cls: string) => (animated ? cls : "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="15" fill="#6a4fb3" />
      <g className={a("logo-lens")}>
        <path d="M39 39 L49 49" stroke="#f2b544" strokeWidth="6.5" strokeLinecap="round" />
        <circle cx="28" cy="28" r="15" fill="#fff" />
      </g>
      <rect x="19.5" y="20" width="17" height="4.4" rx="2.2" fill="#f2b544" className={a("logo-line [animation-delay:450ms]")} />
      <rect x="19.5" y="27" width="13" height="3" rx="1.5" fill="#d9cff3" className={a("logo-line [animation-delay:600ms]")} />
      <rect x="19.5" y="32.5" width="15" height="3" rx="1.5" fill="#d9cff3" className={a("logo-line [animation-delay:720ms]")} />
    </svg>
  );
}

export function Logo({ size = 36, light = false, tagline = false, animated = false }: { size?: number; light?: boolean; tagline?: boolean; animated?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} animated={animated} className="shrink-0" />
      <span className="leading-tight">
        <span className={`rf-wordmark block font-display font-semibold tracking-tight ${light ? "text-white" : "text-slate-900"}`} style={{ fontSize: Math.max(15, size * 0.58) }}>
          {BRAND.name}
        </span>
        {tagline && <span className={`block text-[11px] ${light ? "text-white/60" : "text-slate-500"}`}>{BRAND.tagline}</span>}
      </span>
    </span>
  );
}
