"use client";

import { useEffect, useRef, useState } from "react";

/** The client's logo (or site icon); falls back to their initials if the image can't load. */
export function ClientLogo({ src, initials }: { src: string; initials: string }) {
  const [ok, setOk] = useState(true);
  const img = useRef<HTMLImageElement>(null);
  // The image may fail before React hydrates, so check once on mount too.
  useEffect(() => { const i = img.current; if (i && i.complete && i.naturalWidth <= 16) setOk(false); }, []);
  return (
    <span className="relative grid h-14 w-14 place-items-center overflow-hidden rounded-[0.9rem] bg-[#fff] text-lg font-semibold text-[#1c1b45] md:h-16 md:w-16">
      {initials}
      {ok && (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={img} src={src} alt="" onError={() => setOk(false)} onLoad={(e) => e.currentTarget.naturalWidth <= 16 && setOk(false)} className="absolute inset-0 m-auto h-9 w-9 rounded-md bg-[#fff] object-contain md:h-10 md:w-10" />
      )}
    </span>
  );
}
