"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, MapPin, RotateCw, Search } from "lucide-react";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "@/components/explore/store";
import { Button, Skeleton, Spinner } from "@/components/ui/primitives";
import { cityName } from "@/components/ui/CityPicker";
import { useFeatures } from "./features";
import { SpotCard } from "./cards";
import { ErrorNote, ScreenPanel, ScreenTitle, useMapOverlay, useOpenMap, useSelectNeighborhood } from "./shared";

/** A couple of real streets per city, so the empty screen has something to click. */
const EXAMPLES: Record<string, string[]> = {
  lisbon: ["Rua da Rosa 120", "Largo do Intendente 45"],
  berlin: ["Oranienstraße 25", "Weserstraße 50"],
  london: ["Columbia Road 94", "Brick Lane 120"],
  paris: ["Rue de Bretagne 30", "Rue Oberkampf 80"],
  "new york": ["Bedford Avenue 200", "Orchard Street 100"],
  barcelona: ["Carrer de Verdi 20", "Carrer del Parlament 30"],
  tokyo: ["Shimokitazawa 2-14", "Nakameguro 1-10"],
  "mexico city": ["Calle Colima 160", "Avenida Amsterdam 240"],
};

export function AddressScreen() {
  const ex = useExplore();
  const f = useFeatures();
  const here = cityName(ex.state.city);
  const [text, setText] = useState("");
  const select = useSelectNeighborhood();
  const openMap = useOpenMap();
  const [picked, setPicked] = useState<string | null>(null);
  const hasLoves = activeLoves(ex.state.loves).length > 0;
  const examples = EXAMPLES[here.toLowerCase()] ?? [];
  const r = f.spot.data;

  // an address typed for the old city means nothing in the new one
  const cityKey = ex.state.city.trim().toLowerCase();
  const typedFor = useRef(cityKey);
  useEffect(() => {
    if (typedFor.current === cityKey) return;
    typedFor.current = cityKey;
    setText("");
  }, [cityKey]);

  // the loves changed since the last check: check the same spot again for the new taste
  const lastWhere = useRef<{ query?: string; point?: [number, number] } | null>(null);
  useEffect(() => {
    if (f.spot.stale && !f.spot.loading && r && hasLoves) void f.checkSpot(lastWhere.current ?? { point: r.point });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.spot.stale]);

  const check = (where: { query?: string; point?: [number, number] }) => {
    lastWhere.current = where;
    setPicked(null);
    void f.checkSpot(where);
  };

  // a click on the map checks that point
  const stateRef = useRef(ex.state);
  stateRef.current = ex.state;
  const checkRef = useRef(check);
  checkRef.current = check;
  const onMapClick = useCallback((p: [number, number]) => {
    if (activeLoves(stateRef.current.loves).length) checkRef.current({ point: p });
  }, []);
  const overlay = useMemo(() => {
    if (!r) return { onMapClick };
    const [lon, lat] = r.point;
    return {
      pin: { lon, lat, label: r.label },
      ring: { lon, lat, meters: 1000 },
      places: r.walk.map((w) => w.place),
      focus: r.point,
      onMapClick,
    };
  }, [r, onMapClick]);
  useMapOverlay(overlay);

  const pickHood = (id: string) => {
    if (select(id)) setPicked(id);
  };

  return (
    <ScreenPanel label="Check an address" testId="address-screen">
      <ScreenTitle
        title="Check an address"
        lead={<>Paste the address of a flat you are looking at. Homing estimates how well the area around it fits your taste and what you would have within a short walk.</>}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 2) check({ query: text.trim() });
        }}
        className="flex gap-2"
      >
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-paper-raised px-3 ring-1 ring-line transition-shadow focus-within:ring-2 focus-within:ring-you">
          <MapPin size={16} strokeWidth={1.75} className="shrink-0 text-you" />
          <input
            data-testid="address-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={examples[0] ? `For example ${examples[0]}` : `A street and number in ${here}`}
            maxLength={160}
            autoComplete="off"
            spellCheck={false}
            className="w-full min-w-0 bg-transparent text-[15px] font-[540] text-ink outline-none placeholder:font-[450] placeholder:text-ink-3"
          />
        </div>
        <Button data-testid="address-submit" type="submit" variant="primary" size="md" disabled={f.spot.loading || text.trim().length < 2 || !hasLoves}>
          {f.spot.loading ? <Spinner size={15} /> : <Search size={15} strokeWidth={2} />} Check
        </Button>
      </form>
      <p className="mt-1.5 text-[12.5px] text-ink-3">
        Any street address or place name in {here} works, or click a spot on the map.
      </p>

      {f.recentSpots.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[12.5px] font-[560] text-ink-3">Checked so far</p>
          <div className="flex flex-wrap gap-1.5">
            {f.recentSpots.map((s) => {
              const on = r?.label === s.result.label;
              return (
                <button
                  key={s.result.label}
                  onClick={() => (s.stale ? check(s.query ? { query: s.query } : { point: s.result.point }) : f.showSpot(s.result))}
                  className={`flex h-8 max-w-full items-center gap-2 rounded-[9px] px-2.5 text-[12.5px] font-[540] transition-colors ${on ? "bg-ink text-paper" : "bg-paper-sunk text-ink-2 hover:text-ink"}`}
                >
                  <span className="max-w-[170px] truncate">{s.result.label}</span>
                  <span className={`tnum font-[650] ${on ? "text-paper" : s.stale ? "text-ink-3" : "text-you-deep"}`}>{Math.round(s.result.percentile)}%</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5">
        {!hasLoves && (
          <div className="rounded-[18px] bg-paper-sunk/70 p-4 text-[14px] leading-relaxed text-ink-2">
            An address is scored against your taste, so add a few things you love on the Map screen first.
          </div>
        )}

        {f.spot.error && <ErrorNote message={f.spot.error.message} onRetry={f.spot.error.retryable ? () => lastWhere.current && check(lastWhere.current) : undefined} />}

        {f.spot.loading && !r && (
          <div className="space-y-2.5">
            <p className="text-[13.5px] text-ink-2">Finding {f.spot.query ?? "the spot"} and reading what is around it.</p>
            <Skeleton className="h-[170px]" />
            <Skeleton className="h-[96px]" />
            <Skeleton className="h-[160px]" />
          </div>
        )}

        {r && (
          <div className={`transition-opacity ${f.spot.loading ? "opacity-55" : ""}`}>
            {f.spot.loading && (
              <p className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-3">
                <RotateCw size={13} className="animate-spin" /> Checking {f.spot.query ?? "again"}
              </p>
            )}
            <SpotCard result={r} onPickNeighborhood={r.neighborhood && ex.hoods.data?.some((n) => n.id === r.neighborhood!.id) ? pickHood : undefined} />
            <AnimatePresence>
              {picked && r.neighborhood?.id === picked && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="mt-3 flex items-center justify-between gap-3 rounded-[14px] bg-paper-sunk/80 px-3.5 py-2.5 text-[13px] text-ink-2"
                >
                  <span>{r.neighborhood.name} is selected on your map.</span>
                  <button onClick={openMap} className="flex shrink-0 items-center gap-1 font-[600] text-you-deep hover:underline">
                    See its places <ArrowRight size={14} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {hasLoves && !r && !f.spot.loading && !f.spot.error && (
          <div className="rounded-[18px] bg-paper-sunk/70 p-4 text-[14px] leading-relaxed text-ink-2">
            <p>
              Homing reads your taste map at that point, ranks it against the rest of {here}, and lists the cafés, food, bars and culture that fit you within about a 12 minute walk. The taste map has about 1 km resolution, so the score describes the area around the flat, not the building itself.
            </p>
            {examples.length > 0 && (
              <>
                <p className="mt-3 text-[12.5px] font-[580] text-ink-3">Try one</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {examples.map((q) => (
                    <button
                      key={q}
                      onClick={() => {
                        setText(q);
                        check({ query: q });
                      }}
                      className="flex h-9 items-center gap-1.5 rounded-[11px] bg-paper-raised px-3 text-[13.5px] font-[580] text-ink shadow-[var(--shadow-rest)] ring-1 ring-line transition-transform hover:-translate-y-px"
                    >
                      {q} <ArrowRight size={14} className="text-you" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </ScreenPanel>
  );
}
