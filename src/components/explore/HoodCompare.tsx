"use client";

import { motion } from "motion/react";
import { X } from "lucide-react";
import type { Neighborhood } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "./store";
import { LOVE_INKS } from "./inks";
import { MatchValue } from "@/components/ui/Match";
import { CROWD_TOOLTIP, crowdLine, crowdOf } from "@/lib/honest";

/** Two neighborhoods side by side: rank and match, what pulls each up, how its places feel, how busy it is. */
export function HoodCompare({ a, b, onOpen, onClose }: { a: Neighborhood; b: Neighborhood; onOpen?: (id: string) => void; onClose?: () => void }) {
  const ex = useExplore();
  const order = activeLoves(ex.state.loves).map((l) => l.chosen.name);
  const col = (n: Neighborhood) => (
    <div className="min-w-0">
      {/* the button spans the column so a long name wraps inside it instead of running into the other column */}
      <button onClick={() => (onOpen ? onOpen(n.id) : ex.patch([{ op: "select_neighborhood", id: n.id }]))} className="block w-full text-left">
        <span className="line-clamp-2 text-[16px] font-[650] leading-[1.15] tracking-[-0.02em] hover:underline sm:text-[18px]">{n.name}</span>
      </button>
      <p className="mt-1 text-[12.5px] text-ink-3">Ranked {n.rank} for your taste</p>
      <MatchValue score={n.score} size="lg" className="mt-1.5" />
      <div className="mt-3 space-y-1.5">
        {order.map((love, i) => {
          const share = n.drivers.find((d) => d.love === love)?.share ?? 0;
          return (
            <div key={love} className="flex items-center gap-2 text-[12px] text-ink-2">
              <span className="w-[72px] shrink-0 truncate sm:w-[92px]">{love}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-sunk">
                <motion.span className="block h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${share * 100}%` }} style={{ background: LOVE_INKS[i % LOVE_INKS.length] }} />
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[13px] text-ink-2">{n.matchedTags.length ? n.matchedTags.join(", ") : "No strong place style"}</p>
      <p className="mt-1 text-[12.5px] text-ink-3" title={CROWD_TOOLTIP}>
        {crowdLine(crowdOf(n))}
      </p>
      {n.samplePlaces.length > 0 && <p className="mt-2 text-[12.5px] text-ink-3">{n.samplePlaces.slice(0, 3).join(", ")}</p>}
    </div>
  );
  return (
    <motion.div layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-[18px] bg-paper-raised p-4 ring-1 ring-ink/15 shadow-[var(--shadow-raised)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-[600] text-ink-3">Rank and match, which loves pull it up, how its places feel</h3>
        {onClose && (
          <button onClick={onClose} aria-label="Close comparison" className="grid h-7 w-7 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-sunk hover:text-ink">
            <X size={15} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {col(a)}
        {col(b)}
      </div>
    </motion.div>
  );
}
