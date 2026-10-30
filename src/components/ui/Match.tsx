"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Info } from "lucide-react";
import { BELOW_NEUTRAL_NOTE, MATCH_EXPLAINER, MATCH_LABEL, matchIndex } from "@/lib/honest";

/** "Match 54": the neighborhood's ordering score on a 0-100 scale, 50 neutral, with the meaning on hover. */
export function MatchValue({
  score,
  size = "md",
  className = "",
}: {
  score: number | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const m = matchIndex(score);
  if (m === null) return null;
  const num = size === "lg" ? "text-[30px] font-[690] tracking-[-0.03em]" : size === "md" ? "text-[17px] font-[640]" : "text-[13px] font-[620]";
  const word = size === "lg" ? "text-[13px]" : size === "md" ? "text-[12px]" : "text-[12px]";
  return (
    <span title={MATCH_EXPLAINER} data-testid="match-index" className={`inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap ${className}`}>
      <span className={`${word} font-[540] text-ink-3`}>{MATCH_LABEL}</span>
      <span className={`tnum leading-none ${num} ${m >= 50 ? "text-ink" : "text-ink-2"}`}>{m}</span>
    </span>
  );
}

/** One quiet line that opens the explanation, so the meaning is reachable on a phone too. */
export function MatchExplainer({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1 rounded-[7px] text-[12px] font-[560] text-ink-3 hover:text-ink">
        <Info size={13} /> What {MATCH_LABEL} means
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.p
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden text-[12.5px] leading-snug text-ink-2"
          >
            <span className="block pt-1">{MATCH_EXPLAINER}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Shown under a ranked list when the backend says no area reaches neutral. */
export function BelowNeutralNote({ show, text = BELOW_NEUTRAL_NOTE, className = "" }: { show: boolean; text?: string; className?: string }) {
  if (!show) return null;
  return (
    <p data-testid="ranking-note" className={`rounded-[12px] bg-paper-sunk/80 px-3 py-2 text-[13px] leading-snug text-ink-2 ${className}`}>
      {text}
    </p>
  );
}
