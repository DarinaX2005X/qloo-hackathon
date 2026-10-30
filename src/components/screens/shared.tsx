"use client";

import { useGoTo } from "@/components/explore/nav";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { RefreshCw } from "lucide-react";
import { useExplore, type MapOverlay } from "@/components/explore/store";
import { Button } from "@/components/ui/primitives";

export function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 860px)");
    const on = () => setM(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return m;
}

/** Puts this screen's layer on the shared map while it is shown, and takes it off on the way out. */
export function useMapOverlay(overlay: MapOverlay | null) {
  const ex = useExplore();
  const set = useRef(ex.setOverlay);
  set.current = ex.setOverlay;
  useEffect(() => {
    set.current(overlay);
  }, [overlay]);
  useEffect(() => () => set.current(null), []);
}

/** Selects a neighborhood when the ranking has it; returns false when it doesn't. */
export function useSelectNeighborhood() {
  const ex = useExplore();
  return useCallback(
    (id: string) => {
      if (!ex.hoods.data?.some((n) => n.id === id)) return false;
      ex.patch([{ op: "select_neighborhood", id }]);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ex.hoods.data, ex.patch],
  );
}

/** Goes to the Map screen with the state as it is, so an opened neighborhood shows its places. */
export function useOpenMap() {
  const goTo = useGoTo();
  return useCallback(() => goTo("/explore"), [goTo]);
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-[14px] bg-[color-mix(in_oklch,var(--err)_7%,var(--paper-raised))] p-3.5 text-[14px] text-ink ring-1 ring-[color-mix(in_oklch,var(--err)_22%,transparent)]">
      <p>{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-2.5" onClick={onRetry}>
          <RefreshCw size={14} /> Try again
        </Button>
      )}
    </div>
  );
}

/** The floating panel a screen lives in: a column over the map on desktop, a bottom sheet on a phone. */
export function ScreenPanel({ children, label, testId }: { children: React.ReactNode; label: string; testId?: string }) {
  const mobile = useIsMobile();
  if (mobile)
    return (
      <motion.section
        key="sheet"
        aria-label={label}
        data-testid={testId}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 34 }}
        className="hm-screen-sheet pointer-events-auto absolute inset-x-0 bottom-[var(--hm-tabbar,0px)] z-20 flex h-[56dvh] flex-col overflow-hidden rounded-t-[24px] bg-paper-raised shadow-[var(--shadow-overlay)] ring-1 ring-line"
      >
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong/70" aria-hidden />
        <div className="hm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">{children}</div>
      </motion.section>
    );
  return (
    <motion.section
      key="panel"
      aria-label={label}
      data-testid={testId}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 32 }}
      className="hm-screen-panel pointer-events-auto absolute bottom-4 left-[var(--hm-panel-left,92px)] top-[76px] z-20 flex w-[440px] flex-col overflow-hidden rounded-[24px] bg-paper-raised/95 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur"
    >
      <div className="hm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-5">{children}</div>
    </motion.section>
  );
}

export function ScreenTitle({ title, lead }: { title: string; lead?: React.ReactNode }) {
  return (
    <header className="mb-4">
      <h2 className="text-[24px] font-[680] leading-tight tracking-[-0.025em]">{title}</h2>
      {lead && <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{lead}</p>}
    </header>
  );
}

/** A one-line legend floating over the map, away from the panel. */
export function MapNote({ children }: { children: React.ReactNode }) {
  const mobile = useIsMobile();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: "spring", stiffness: 340, damping: 32 }}
      className={`pointer-events-none absolute z-10 max-w-[calc(100%-32px)] rounded-full bg-paper-raised/95 px-3.5 py-2 text-[13px] font-[540] text-ink-2 shadow-[var(--shadow-raised)] ring-1 ring-line backdrop-blur ${mobile ? "left-4 top-[68px]" : "bottom-4 left-[calc(var(--hm-panel-left,92px)+456px)]"}`}
    >
      {children}
    </motion.div>
  );
}
