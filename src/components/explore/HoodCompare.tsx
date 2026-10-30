"use client";

import { motion } from "motion/react";
import { X } from "lucide-react";
import type { AreaDecision } from "@/shared/contracts-09";
import { AreaRank, SupportTag } from "@/components/ui/Metric";
import { VenueRow, areaName, areaScale, ROLE_PLURAL } from "@/components/screens/venue";
import { useExplore } from "./store";

/** Two areas side by side: rank in the same list, what the backend says about each, and the checked places behind it. */
export function HoodCompare({ a, b, onOpen, onClose }: { a: AreaDecision; b: AreaDecision; onOpen?: (id: string) => void; onClose?: () => void }) {
  const ex = useExplore();
  const col = (d: AreaDecision) => {
    const roles = [...new Set(d.anchors.filter((v) => v.eligibility === "eligible").map((v) => ROLE_PLURAL[v.role]))];
    return (
      <div className="min-w-0" data-testid="hood-compare-col">
        {/* the button spans the column so a long name wraps inside it instead of running into the other column */}
        <button onClick={() => (onOpen ? onOpen(d.area.id) : ex.patch([{ op: "select_neighborhood", id: d.area.id }]))} className="block w-full text-left">
          <span className="line-clamp-2 text-[16px] font-[650] leading-[1.15] tracking-[-0.02em] hover:underline sm:text-[18px]">{areaName(d.area)}</span>
        </button>
        <p className="mt-0.5 text-[12px] text-ink-3">{areaScale(d.area)}</p>
        <AreaRank metrics={d.metrics} size="md" className="mt-2" />
        {d.metrics.support.quality !== "sufficient" && <SupportTag quality={d.metrics.support.quality} className="mt-1.5" />}
        {d.headline && <p className="mt-2.5 text-[13px] leading-snug text-ink">{d.headline}</p>}
        {d.tradeoff && <p className="mt-1.5 text-[12.5px] leading-snug text-ink-3">Keep in mind: {d.tradeoff}</p>}
        <p className="mt-2.5 text-[12.5px] font-[580] text-ink-2">
          {roles.length ? `Checked places for ${roles.join(", ")}` : "No everyday places confirmed yet"}
        </p>
        <div className="-mx-1 mt-1">
          {d.anchors.slice(0, 3).map((v) => (
            <VenueRow key={v.venueKey} v={v} compact />
          ))}
        </div>
      </div>
    );
  };
  return (
    <motion.div layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-[18px] bg-paper-raised p-4 shadow-[var(--shadow-raised)] ring-1 ring-ink/15">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-[600] text-ink-3">Place in the list, the reason, and the places behind it</h3>
        {onClose && (
          <button onClick={onClose} aria-label="Close comparison" className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-sunk hover:text-ink">
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
