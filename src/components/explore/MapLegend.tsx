"use client";

import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";

/** How to read the terrain, collapsible and remembered per browser. */
export function MapLegend({ pair }: { pair: boolean }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("homing.legend") === "closed") setOpen(false);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const set = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem("homing.legend", v ? "open" : "closed");
    } catch {
      /* storage unavailable */
    }
  };
  if (!open)
    return (
      <button onClick={() => set(true)} aria-label="How to read the map" className="grid h-10 w-10 place-items-center rounded-[12px] bg-paper-raised/95 text-ink-2 shadow-[var(--shadow-rest)] ring-1 ring-line hover:text-ink">
        <Info size={17} />
      </button>
    );
  return (
    <div className="w-[260px] rounded-[16px] bg-paper-raised/95 p-3.5 text-[12.5px] leading-snug text-ink-2 shadow-[var(--shadow-raised)] ring-1 ring-line backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-[620] text-ink">Reading the map</span>
        <button onClick={() => set(false)} aria-label="Hide" className="grid h-6 w-6 place-items-center rounded-[7px] text-ink-3 hover:bg-paper-sunk hover:text-ink">
          <X size={13} />
        </button>
      </div>
      <p>Taller, darker columns: a stronger signal for what you love, adjusted for how busy the area is.</p>
      {pair ? (
        <div className="mt-2 flex items-center gap-3">
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[3px] bg-you" /> You</span>
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[3px] bg-them" /> Them</span>
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[3px] bg-both" /> Both</span>
        </div>
      ) : (
        <div className="mt-2 h-2 rounded-full" style={{ background: "linear-gradient(90deg, #f6e2d6, #f4b096, #e86e50, #d6482f, #a0281c)" }} />
      )}
      <p className="mt-2 text-ink-3">Hover a column for what drives it. Click it to open the nearest neighborhood.</p>
    </div>
  );
}
