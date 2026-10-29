"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { decodeState } from "@/lib/state";
import { useExplore } from "./store";
import { cityName } from "@/components/ui/CityPicker";

type Recent = { s: string; city: string; loves: string[]; at: number };

/** Maps this browser made before, so a returning person picks up where they left off. */
export function RecentMaps() {
  const ex = useExplore();
  const [items, setItems] = useState<Recent[]>([]);
  useEffect(() => {
    try {
      setItems((JSON.parse(localStorage.getItem("homing.recent") ?? "[]") as Recent[]).slice(0, 4));
    } catch {
      setItems([]);
    }
  }, []);
  if (!items.length) return null;
  return (
    <div className="mt-5">
      <p className="mb-2 flex items-center gap-1.5 text-[13px] font-[560] text-ink-3">
        <History size={13} /> Your recent maps
      </p>
      <div className="flex flex-col gap-1.5">
        {items.map((r) => (
          <button
            key={r.s}
            onClick={() => {
              const s = decodeState(r.s);
              if (s) ex.setState(() => s);
            }}
            className="rounded-[12px] px-3 py-2 text-left ring-1 ring-line transition-colors hover:bg-paper-sunk"
          >
            <span className="block text-[14px] font-[580] text-ink">{cityName(r.city)}</span>
            <span className="block truncate text-[12.5px] text-ink-3">{r.loves.join(", ")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
