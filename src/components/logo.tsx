import { BRAND } from "@/lib/brand";

/**
 * Logo mark: three rising bars (rankings) with a flowing arrow sweeping up through them
 * (the keyword → topic → article → ranking pipeline), on an indigo-to-fuchsia tile.
 */
export function LogoMark({ size = 36, animated = false, className = "" }: { size?: number; animated?: boolean; className?: string }) {
  const id = `lg${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="0.55" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#D946EF" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="24" y1="0" x2="24" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${id}-bg)`} />
      <rect width="48" height="26" rx="13" fill={`url(#${id}-shine)`} />
      <g fill="#fff" fillOpacity="0.38">
        <rect x="11" y="28" width="6" height="9" rx="2" className={animated ? "logo-bar [animation-delay:0ms]" : ""} />
        <rect x="21" y="22" width="6" height="15" rx="2" className={animated ? "logo-bar [animation-delay:120ms]" : ""} />
        <rect x="31" y="15" width="6" height="22" rx="2" className={animated ? "logo-bar [animation-delay:240ms]" : ""} />
      </g>
      <path
        d="M9 31.5C15 31.5 17 23 24 23S31 13.5 38 12.5"
        fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round"
        className={animated ? "logo-flow" : ""}
      />
      <path d="M33.2 10.6 38.6 12.2 36.6 17.4" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = 36, light = false, tagline = false, animated = false }: { size?: number; light?: boolean; tagline?: boolean; animated?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} animated={animated} className="shrink-0 drop-shadow-[0_6px_14px_rgba(139,92,246,0.45)]" />
      <span className="leading-tight">
        <span className={`block font-bold tracking-tight ${light ? "text-white" : "text-slate-900"}`} style={{ fontSize: size * 0.5 }}>
          {BRAND.name.slice(0, 4)}
          <span className={light ? "bg-gradient-to-r from-indigo-300 to-fuchsia-300 bg-clip-text text-transparent" : "bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-transparent"}>{BRAND.name.slice(4)}</span>
        </span>
        {tagline && <span className={`block text-[11px] ${light ? "text-indigo-200/60" : "text-slate-500"}`}>{BRAND.tagline}</span>}
      </span>
    </span>
  );
}
