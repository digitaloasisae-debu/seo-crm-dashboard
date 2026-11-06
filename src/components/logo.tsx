import { BRAND } from "@/lib/brand";

/**
 * Logo mark ("Search Page"): a magnifying glass whose lens holds a blog page,
 * with the top line in gold for the #1 result. Blog content that gets found on Google.
 */
export function LogoMark({ size = 36, animated = false, className = "" }: { size?: number; animated?: boolean; className?: string }) {
  const id = `lg${size}`;
  const a = (cls: string) => (animated ? cls : "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4F46E5" />
          <stop offset="0.6" stopColor="#7C3AED" />
          <stop offset="1" stopColor="#C026D3" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FDE68A" />
          <stop offset="1" stopColor="#F59E0B" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="32" y1="0" x2="32" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id}-bg)`} />
      <rect width="64" height="34" rx="16" fill={`url(#${id}-shine)`} />
      <g className={a("logo-lens")}>
        <path d="M39 39 L49 49" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
        <circle cx="28" cy="28" r="15" fill="#fff" />
      </g>
      <rect x="19.5" y="20" width="17" height="4.4" rx="2.2" fill={`url(#${id}-gold)`} className={a("logo-line [animation-delay:450ms]")} />
      <rect x="19.5" y="27" width="13" height="3" rx="1.5" fill="#C7D2FE" className={a("logo-line [animation-delay:600ms]")} />
      <rect x="19.5" y="32.5" width="15" height="3" rx="1.5" fill="#C7D2FE" className={a("logo-line [animation-delay:720ms]")} />
    </svg>
  );
}

export function Logo({ size = 36, light = false, tagline = false, animated = false }: { size?: number; light?: boolean; tagline?: boolean; animated?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} animated={animated} className={`shrink-0 ${light ? "drop-shadow-[0_6px_14px_rgba(139,92,246,0.45)]" : ""}`} />
      <span className="leading-tight">
        <span className={`block font-display font-bold tracking-tight ${light ? "text-white" : "text-slate-900"}`} style={{ fontSize: size * 0.5 }}>
          {BRAND.name.slice(0, 4)}
          <span className={light ? "bg-gradient-to-r from-indigo-300 to-fuchsia-300 bg-clip-text text-transparent" : "text-indigo-600"}>{BRAND.name.slice(4)}</span>
        </span>
        {tagline && <span className={`block text-[11px] ${light ? "text-indigo-200/60" : "text-slate-500"}`}>{BRAND.tagline}</span>}
      </span>
    </span>
  );
}
