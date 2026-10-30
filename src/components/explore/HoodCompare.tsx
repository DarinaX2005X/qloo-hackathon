"use client";

import { motion } from "motion/react";
import { X } from "lucide-react";
import type { Neighborhood } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "./store";
import { LOVE_INKS } from "./inks";

const VIBE: Record<Neighborhood["vibe"], string> = { local: "Mostly locals", mixed: "Locals and visitors", touristy: "Busy with visitors" };

/** Two neighborhoods side by side: score, what pulls each up, how its places feel, who is around. */
export function HoodCompare({ a, b, onOpen, onClose }: { a: Neighborhood; b: Neighborhood; onOpen?: (id: string) => void; onClose?: () => void }) {
  const ex = useExplore();
  const order = activeLoves(ex.state.loves).map((l) => l.chosen.name);
  const col = (n: Neighborhood, other: Neighborhood) => (
    <div className="min-w-0">
      <button onClick={() => (onOpen ? onOpen(n.id) : ex.patch([{ op: "select_neighborhood", id: n.id }]))} className="text-left">
        <span className="block truncate text-[18px] font-[650] tracking-[-0.02em] hover:underline">{n.name}</span>
      </button>
      <span className={`tnum mt-1 block text-[30px] font-[690] leading-none tracking-[-0.03em] ${n.score >= other.score ? "text-you" : "text-ink-2"}`}>{Math.round(n.score * 100)}</span>
      <div className="mt-3 space-y-1.5">
        {order.map((love, i) => {
          const share = n.drivers.find((d) => d.love === love)?.share ?? 0;
          return (
            <div key={love} className="flex items-center gap-2 text-[12px] text-ink-2">
              <span className="w-[92px] shrink-0 truncate">{love}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-sunk">
                <motion.span className="block h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${share * 100}%` }} style={{ background: LOVE_INKS[i % LOVE_INKS.length] }} />
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[13px] text-ink-2">{n.matchedTags.length ? n.matchedTags.join(", ") : "No strong place style"}</p>
      <p className="mt-1 text-[12.5px] text-ink-3">{VIBE[n.vibe]}</p>
      {n.samplePlaces.length > 0 && <p className="mt-2 text-[12.5px] text-ink-3">{n.samplePlaces.slice(0, 3).join(", ")}</p>}
    </div>
  );
  return (
    <motion.div layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-[18px] bg-paper-raised p-4 ring-1 ring-ink/15 shadow-[var(--shadow-raised)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-[600] text-ink-3">Score for your taste, what lifts it, how its places feel</h3>
        {onClose && (
          <button onClick={onClose} aria-label="Close comparison" className="grid h-7 w-7 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-sunk hover:text-ink">
            <X size={15} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {col(a, b)}
        {col(b, a)}
      </div>
    </motion.div>
  );
}
