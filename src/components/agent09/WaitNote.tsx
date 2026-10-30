"use client";

import { useEffect, useState } from "react";

/** While a turn runs long, say so plainly with the elapsed time; a first look at a city can take tens of seconds. */
export function WaitNote({ active, after = 10 }: { active: boolean; after?: number }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  const s = Math.round((now - start) / 1000);
  if (!active || s < after) return null;
  return (
    <p className="tnum text-[12.5px] leading-snug text-ink-3" aria-live="off" data-testid="wait-note">
      Working for {s} s. The first look at a city fetches fresh data and can take up to a minute; results appear here as each step finishes.
    </p>
  );
}
