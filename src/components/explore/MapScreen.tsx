"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronUp, House, Pencil } from "lucide-react";
import type { ResolvedLove } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "./store";
import { TastePanel } from "./TastePanel";
import { ResultsPanel, useShortlist } from "./ResultsPanel";
import { MapLegend } from "./MapLegend";
import { AskBar } from "./AskBar";
import { useIsMobile, useScreenHref } from "./nav";
import Link from "next/link";

const enter = { duration: 0.42, ease: [0.2, 0.8, 0.2, 1] as const };
/** Desktop width of the one map panel; the map gets the rest (AppShell pads the camera by the same amount). */
export const MAP_PANEL = 392;

type Sheet = "peek" | "results" | "taste";

function names(loves: ResolvedLove[]) {
  const n = activeLoves(loves).map((l) => l.chosen.name);
  if (n.length <= 2) return n.join(" and ");
  return `${n.slice(0, 2).join(", ")} and ${n.length - 2} more`;
}

/** The taste behind the results, folded into one row; Edit opens the editor in place of the results. */
function ProfileRow({ onEdit }: { onEdit: () => void }) {
  const ex = useExplore();
  const loves = activeLoves(ex.state.loves);
  const them = ex.state.companion ? activeLoves(ex.state.companion.loves) : [];
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3">
      <div className="flex shrink-0 -space-x-2">
        {loves.slice(0, 3).map((l) =>
          l.chosen.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={l.query} src={l.chosen.image} alt="" className="h-8 w-8 rounded-[9px] object-cover ring-2 ring-paper-raised" />
          ) : (
            <span key={l.query} className="grid h-8 w-8 place-items-center rounded-[9px] bg-you text-[13px] font-[650] text-white ring-2 ring-paper-raised">
              {l.chosen.name.slice(0, 1).toUpperCase()}
            </span>
          ),
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-[560] text-ink-3">For what you love</p>
        <p className="truncate text-[14px] font-[580] text-ink" title={loves.map((l) => l.chosen.name).join(", ")}>
          {names(ex.state.loves)}
          {them.length > 0 && <span className="font-[500] text-them"> and their {them.length}</span>}
        </p>
      </div>
      <button
        onClick={onEdit}
        data-testid="edit-taste"
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-[580] text-ink-2 ring-1 ring-line transition-colors hover:bg-paper-sunk hover:text-ink"
      >
        <Pencil size={14} strokeWidth={1.9} /> Edit
      </button>
    </div>
  );
}

/** The folded phone sheet: the answer in one line, a tap opens the three areas. */
function PeekRow({ onOpen }: { onOpen: () => void }) {
  const { areas, ready } = useShortlist();
  const top = areas.slice(0, 3);
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 px-4 pb-4 pt-1 text-left" data-testid="sheet-peek">
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-[650] tracking-[-0.02em] text-ink">{ready ? "Start with these areas" : "Comparing areas"}</span>
        <span className="block truncate text-[13.5px] text-ink-2">{top.length ? top.map((a) => `${a.rank} ${a.name}`).join(" · ") : "for what you love"}</span>
      </span>
      <ChevronUp size={18} className="shrink-0 text-ink-3" />
    </button>
  );
}

/** A second way in, kept small: start from a neighborhood the person loved living in. */
function HomeLink() {
  const href = useScreenHref();
  return (
    <Link
      href={href("/explore/home")}
      scroll={false}
      className="mx-5 mb-4 mt-1 flex items-center gap-2 rounded-[12px] px-3 py-2.5 text-[13.5px] font-[560] text-ink-2 ring-1 ring-line transition-colors hover:bg-paper-sunk hover:text-ink"
    >
      <House size={15} strokeWidth={1.9} className="text-them" /> Start from a neighborhood you loved instead
    </Link>
  );
}

/** The Map screen: one panel (what you love folded into a row, then the first three areas), the map gets the rest. */
export function MapScreen() {
  const ex = useExplore();
  const mobile = useIsMobile();
  const hasLoves = activeLoves(ex.state.loves).length > 0;
  const pair = !!ex.state.companion && activeLoves(ex.state.companion.loves).length > 0;
  const [editingRaw, setEditing] = useState(!hasLoves);
  const sheet: Sheet = ex.mobileSheet;
  const editing = mobile ? sheet === "taste" || !hasLoves : editingRaw || !hasLoves;
  const edit = (on: boolean) => {
    setEditing(on);
    if (mobile || ex.mobileSheet === "taste") ex.setMobileSheet(on ? "taste" : "results");
  };

  // opening an area (from the map or a card) always shows the results
  const hood = ex.state.neighborhood ?? null;
  useEffect(() => {
    if (hood) edit(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hood]);
  // the first loves of an empty map: once the ranking arrives, the answer comes forward
  const hadHoods = useRef(!!ex.hoods.data?.length);
  useEffect(() => {
    const has = !!ex.hoods.data?.length;
    if (has && !hadHoods.current && !document.activeElement?.closest("[data-taste-editor]")) edit(false);
    hadHoods.current = has;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.hoods.data]);

  const body = mobile && sheet === "peek" && !editing ? (
    <motion.div key="peek" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <PeekRow onOpen={() => ex.setMobileSheet("results")} />
    </motion.div>
  ) : editing ? (
    <motion.div key="edit" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.22 }}>
      <TastePanel compact={mobile} onDone={hasLoves ? () => edit(false) : undefined} footer={!hasLoves ? <HomeLink /> : null} />
    </motion.div>
  ) : (
    <motion.div key="results" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
      <ProfileRow onEdit={() => edit(true)} />
      <div className="min-h-0 flex-1">
        <ResultsPanel />
      </div>
      {!mobile && <AskBar />}
    </motion.div>
  );

  if (mobile) {
    const height = editing ? "74%" : sheet === "peek" ? "116px" : "58%";
    return (
      <motion.div
        data-testid="map-sheet"
        animate={{ height }}
        initial={false}
        transition={{ type: "spring", stiffness: 380, damping: 40 }}
        className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[24px] bg-paper-raised shadow-[var(--shadow-overlay)] ring-1 ring-line"
      >
        <button
          type="button"
          onClick={() => ex.setMobileSheet(sheet === "peek" ? "results" : "peek")}
          aria-label={sheet === "peek" ? "Show the shortlist" : "Show more of the map"}
          className="flex h-6 w-full shrink-0 items-center justify-center"
        >
          <span className="h-1 w-9 rounded-full bg-line-strong" />
        </button>
        <AnimatePresence mode="wait" initial={false}>
          {body}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <>
      <motion.aside
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={enter}
        data-testid="map-panel"
        className="absolute bottom-4 left-4 top-[76px] flex flex-col overflow-hidden rounded-[24px] bg-paper-raised/96 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur"
        style={{ width: MAP_PANEL }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {body}
        </AnimatePresence>
      </motion.aside>
      {ex.field.data && !hood && (
        <div className="absolute bottom-4" style={{ left: 16 + MAP_PANEL + 12 }}>
          <MapLegend pair={pair} />
        </div>
      )}
    </>
  );
}
