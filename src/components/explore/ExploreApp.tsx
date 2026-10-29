"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Check, Link2 } from "lucide-react";
import { activeLoves } from "@/shared/contracts";
import { ExploreProvider, useExplore } from "./store";
import { TastePanel } from "./TastePanel";
import { ResultsPanel } from "./ResultsPanel";
import { TerrainMap } from "@/components/map/TerrainMap";
import { LogoMark } from "@/components/brand/Logo";
import { CityPicker } from "@/components/ui/CityPicker";
import { Button, Dial, Segmented, Spinner } from "@/components/ui/primitives";

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 860px)");
    const on = () => setM(q.matches);
    window.addEventListener("resize", on);
    on();
    q.addEventListener("change", on);
    return () => {
      q.removeEventListener("change", on);
      window.removeEventListener("resize", on);
    };
  }, []);
  return m;
}

function ShareButton() {
  const [done, setDone] = useState(false);
  return (
    <Button
      data-testid="share-button"
      variant="secondary"
      size="md"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
        } catch {
          /* clipboard blocked; the URL is still in the address bar */
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? <Check size={16} className="text-ok" /> : <Link2 size={16} strokeWidth={1.9} />}
      {done ? "Link copied" : "Share"}
    </Button>
  );
}

function DiscoveryControl() {
  const ex = useExplore();
  return (
    <div className="flex w-[300px] items-center gap-3">
      <span className="shrink-0 text-[13px] font-[580] text-ink-2">Crowd</span>
      <div className="flex-1">
      <Dial
        label="Popular or local"
        value={ex.state.discovery}
        onChange={(v) => ex.patch([{ op: "set_discovery", value: v }])}
        left="Popular"
        right="Local"
      />
      </div>
    </div>
  );
}

function Status() {
  const ex = useExplore();
  const busy = ex.field.loading || ex.hoods.loading;
  const label = ex.field.loading ? "Mapping your taste" : ex.hoods.loading ? "Ranking neighborhoods" : null;
  return (
    <AnimatePresence>
      {busy && label && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="pointer-events-none absolute left-1/2 top-[84px] z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-3.5 py-2 text-[13px] font-[540] text-paper shadow-[var(--shadow-raised)]"
        >
          <Spinner size={13} /> {label} in {ex.state.city}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Workspace() {
  const ex = useExplore();
  const mobile = useIsMobile();
  const [tab, setTab] = useState<"taste" | "places">("taste");
  const pair = !!ex.state.companion && activeLoves(ex.state.companion.loves).length > 0;
  const onSelect = useCallback((id: string | null) => ex.patch([{ op: "select_neighborhood", id }]), [ex]);
  const loveNames = useMemo(() => Object.fromEntries(activeLoves(ex.state.loves).map((l) => [l.chosen.domain, l.chosen.name])), [ex.state.loves]);
  const route = useMemo(() => ex.plan.data?.days[0]?.stops.map((s) => [s.place.lon, s.place.lat] as [number, number]), [ex.plan.data]);
  const mapPlaces = useMemo(() => {
    if (ex.plan.data) return ex.plan.data.days.flatMap((d) => d.stops.map((s) => s.place));
    return ex.visiblePlaces;
  }, [ex.plan.data, ex.visiblePlaces]);

  // switch the mobile sheet to results once neighborhoods arrive the first time
  const hasHoods = !!ex.hoods.data?.length;
  useEffect(() => {
    if (mobile && hasHoods) setTab("places");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHoods]);

  return (
    <main className="paper-noise relative h-dvh w-full overflow-hidden bg-paper">
      <div className="absolute inset-0">
        <TerrainMap
          field={ex.field.data}
          mode={pair ? "pair" : "you"}
          neighborhoods={ex.hoods.data ?? []}
          selectedId={ex.state.neighborhood ?? null}
          onSelectNeighborhood={onSelect}
          places={mapPlaces}
          activePlaceId={ex.activePlace}
          onHoverPlace={ex.setActivePlace}
          route={route}
          loveNames={loveNames}
          padding={mobile ? { top: 76, bottom: Math.round((typeof window !== "undefined" ? window.innerHeight : 800) * 0.52) + 16, left: 24, right: 24 } : { top: 90, bottom: 40, left: 420, right: 460 }}
        />
      </div>

      {/* top bar */}
      <header className="absolute inset-x-0 top-0 z-30 flex items-center gap-3 px-4 pt-4 md:px-5">
        <Link href="/" className="flex h-10 items-center gap-2 rounded-[12px] bg-paper-raised pl-2 pr-3 shadow-[var(--shadow-rest)] ring-1 ring-line" aria-label="Homing home">
          <LogoMark size={26} />
          <span className="text-[19px] font-[680] tracking-[-0.03em]">homing</span>
        </Link>
        <CityPicker className="w-[190px] shadow-[var(--shadow-rest)]" value={ex.state.city} onChange={(c) => ex.patch([{ op: "set_city", city: c }])} />
        {!mobile && ex.state.loves.length > 0 && (
          <div className="ml-2 rounded-[12px] bg-paper-raised/90 px-3.5 pb-1 pt-1.5 shadow-[var(--shadow-rest)] ring-1 ring-line backdrop-blur">
            <DiscoveryControl />
          </div>
        )}
        <div className="ml-auto">{!mobile && <ShareButton />}</div>
      </header>

      <Status />

      {!mobile ? (
        <>
          <motion.aside
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute bottom-4 left-4 top-[76px] z-20 w-[380px] overflow-hidden rounded-[24px] bg-paper-raised/95 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur"
          >
            <TastePanel />
          </motion.aside>
          <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, delay: 0.08, ease: [0.2, 0.8, 0.2, 1] }}
            className={`absolute right-4 top-[76px] z-20 w-[420px] overflow-hidden rounded-[24px] ${ex.state.loves.length ? "bottom-4" : ""} bg-paper-raised/95 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur`}
          >
            <ResultsPanel />
          </motion.aside>
        </>
      ) : (
        <div className="absolute inset-x-0 bottom-0 z-20 flex h-[52dvh] flex-col overflow-hidden rounded-t-[24px] bg-paper-raised shadow-[var(--shadow-overlay)] ring-1 ring-line">
          <div className="flex items-center gap-2 px-4 pt-3">
            <Segmented
              label="Panel"
              value={tab}
              onChange={setTab}
              options={[
                { value: "taste", label: "Your taste" },
                { value: "places", label: "Neighborhoods" },
              ]}
            />
            <ShareButton />
          </div>
          {tab === "taste" && ex.state.loves.length > 0 && (
            <div className="px-5 pt-3">
              <DiscoveryControl />
            </div>
          )}
          <div className="min-h-0 flex-1">{tab === "taste" ? <TastePanel compact /> : <ResultsPanel />}</div>
        </div>
      )}
    </main>
  );
}

export function ExploreApp() {
  return (
    <ExploreProvider>
      <Workspace />
    </ExploreProvider>
  );
}
