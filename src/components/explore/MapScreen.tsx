"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "./store";
import { TastePanel } from "./TastePanel";
import { ResultsPanel } from "./ResultsPanel";
import { MapLegend } from "./MapLegend";
import { Segmented } from "@/components/ui/primitives";
import { DiscoveryControl } from "./AppShell";
import { useIsMobile } from "./nav";

const enter = { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] as const };

/** The Map screen: what you love on the left, the ranked neighborhoods on the right, the terrain between them. */
export function MapScreen() {
  const ex = useExplore();
  const mobile = useIsMobile();
  const [tab, setTab] = useState<"taste" | "places">("taste");
  const pair = !!ex.state.companion && activeLoves(ex.state.companion.loves).length > 0;

  // on a phone, results come forward once the ranking arrives and whenever a neighborhood opens
  const hasHoods = !!ex.hoods.data?.length;
  useEffect(() => {
    if (mobile && hasHoods) setTab("places");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHoods]);
  const hood = ex.state.neighborhood ?? null;
  useEffect(() => {
    if (mobile && hood) setTab("places");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hood]);

  if (mobile)
    return (
      <div className="absolute inset-x-0 bottom-0 flex h-[52%] flex-col overflow-hidden rounded-t-[24px] bg-paper-raised shadow-[var(--shadow-overlay)] ring-1 ring-line">
        <div className="px-4 pt-3">
          <Segmented
            label="Panel"
            value={tab}
            onChange={setTab}
            options={[
              { value: "taste", label: "Your taste" },
              { value: "places", label: "Neighborhoods" },
            ]}
          />
        </div>
        {tab === "taste" && ex.state.loves.length > 0 && (
          <div className="px-5 pt-3">
            <DiscoveryControl width={350} />
          </div>
        )}
        <div className="min-h-0 flex-1">{tab === "taste" ? <TastePanel compact /> : <ResultsPanel />}</div>
      </div>
    );

  return (
    <>
      <motion.aside
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={enter}
        className="absolute left-4 top-[76px] flex max-h-[calc(100%-92px)] w-[380px] flex-col overflow-hidden rounded-[24px] bg-paper-raised/95 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur"
      >
        <TastePanel />
      </motion.aside>
      <motion.aside
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ ...enter, delay: 0.06 }}
        className={`absolute right-4 top-[76px] w-[420px] overflow-hidden rounded-[24px] ${ex.state.loves.length ? "bottom-4" : ""} bg-paper-raised/95 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur`}
      >
        <ResultsPanel />
      </motion.aside>
      {ex.field.data && (
        <div className="absolute bottom-4 left-[412px]">
          <MapLegend pair={pair} />
        </div>
      )}
    </>
  );
}
