"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Info } from "lucide-react";
import {
  metricExplainer,
  metricNote,
  metricState,
  overlapText,
  OVERLAP_EXPLAINER,
  rankText,
  type MetricInput,
  type Quality,
  type SimilarityInput,
} from "@/lib/honest";

/**
 * The one renderer for an area's number: "#1 of 16 areas checked", and under it at most one quiet line
 * (a percentile the backend allows, "About level with the next area", or "Limited data").
 * Pass B's `AreaMetrics` directly, or `legacyMetrics(n, all)` for an old `Neighborhood`.
 */
export function AreaRank({
  metrics,
  size = "md",
  note = true,
  className = "",
}: {
  metrics: MetricInput | null | undefined;
  size?: "sm" | "md" | "lg";
  /** show the second line; off for tight rows */
  note?: boolean;
  className?: string;
}) {
  if (!metrics) return null;
  const state = metricState(metrics);
  const line = note ? metricNote(metrics) : null;
  const rank = Math.max(1, Math.round(metrics.rank));
  const of = metrics.candidateCount >= rank ? metrics.candidateCount : null;
  const num =
    size === "lg" ? "text-[30px] font-[690] tracking-[-0.03em]" : size === "md" ? "text-[19px] font-[660] tracking-[-0.02em]" : "text-[14px] font-[640]";
  const small = size === "lg" ? "text-[13.5px]" : "text-[12.5px]";
  return (
    <span
      data-testid="area-rank"
      data-state={state}
      title={rankText(metrics)}
      className={`inline-flex shrink-0 flex-col ${size === "sm" ? "items-end" : "items-start"} leading-none ${className}`}
    >
      <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
        <span className={`tnum ${num} ${state === "limited" ? "text-ink-2" : "text-ink"}`}>#{rank}</span>
        {of !== null && <span className={`${small} font-[540] text-ink-3`}>{size === "sm" ? `of ${of}` : `of ${of} areas checked`}</span>}
      </span>
      {line && (
        <span
          data-testid="area-rank-note"
          className={`mt-1 whitespace-nowrap ${size === "sm" ? "text-[11.5px]" : "text-[12.5px]"} font-[540] ${state === "limited" ? "text-ink-3" : state === "close" ? "text-ink-2" : "text-you-deep"}`}
        >
          {line}
        </span>
      )}
    </span>
  );
}

/** "What #1 of 16 means": one quiet line that opens the definition, reachable on a phone too. */
export function MetricNote({
  city,
  candidateCount,
  searchArea,
  className = "",
}: {
  city?: string;
  candidateCount?: number;
  searchArea?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-8 items-center gap-1 rounded-[7px] text-[12.5px] font-[560] text-ink-3 hover:text-ink"
      >
        <Info size={13} /> How areas are ranked
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
            <span className="block pt-1">{metricExplainer({ city, candidateCount, searchArea })}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** "Cultural-profile overlap 42/100" for Feels like home; "Limited data" when the backend has no reliable number. */
export function HomeOverlap({ similarity, className = "" }: { similarity: SimilarityInput | null | undefined; className?: string }) {
  if (!similarity) return null;
  const text = overlapText(similarity);
  if (!text)
    return (
      <span data-testid="home-overlap" data-state="limited" className={`text-[12.5px] font-[540] text-ink-3 ${className}`}>
        Limited data
      </span>
    );
  return (
    <span data-testid="home-overlap" data-state="ok" title={OVERLAP_EXPLAINER} className={`tnum whitespace-nowrap text-[12.5px] font-[580] text-ink-2 ${className}`}>
      {text}
    </span>
  );
}

const QUALITY_TEXT: Record<Quality, string> = { sufficient: "Enough data", limited: "Limited data", unavailable: "No data yet" };

/** A small label for how much data stands behind a result. Sufficient support stays quiet unless asked for. */
export function SupportTag({ quality, always = false, className = "" }: { quality: Quality | null | undefined; always?: boolean; className?: string }) {
  if (!quality || (quality === "sufficient" && !always)) return null;
  return (
    <span
      data-testid="support-tag"
      data-quality={quality}
      className={`inline-flex h-6 items-center rounded-[6px] px-2 text-[12px] font-[560] ${quality === "sufficient" ? "bg-paper-sunk text-ink-2" : "bg-paper-sunk text-ink-3 ring-1 ring-line"} ${className}`}
    >
      {QUALITY_TEXT[quality]}
    </span>
  );
}
