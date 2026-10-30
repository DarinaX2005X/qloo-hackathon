"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, MapPin, RotateCw, Search } from "lucide-react";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "@/components/explore/store";
import { PlaceDrawer } from "@/components/explore/PlaceDrawer";
import { Button, Skeleton, Spinner } from "@/components/ui/primitives";
import { cityName } from "@/components/ui/CityPicker";
import { useFeatures } from "./features";
import { AddressCard } from "./decision";
import { areaName } from "./venue";
import { ErrorNote, ScreenPanel, ScreenTitle, useAreaActions, useMapOverlay } from "./shared";

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
const PRECISION_SHORT = {
  building: "",
  street: "street only",
  area: "area only",
} as const;

export function AddressScreen() {
  const ex = useExplore();
  const f = useFeatures();
  const actions = useAreaActions();
  const here = cityName(ex.state.city);
  const [text, setText] = useState("");
  const hasLoves = activeLoves(ex.state.loves).length > 0;
  const examples = EXAMPLES[here.toLowerCase()] ?? [];
  const r = f.spot.data;
  const selected = ex.selectedArea;

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
    void f.checkSpot({
      ...where,
      ...(selected ? { areaId: selected.area.id } : {}),
    });
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
    const radius = r.area?.area.geometry.kind === "circle" ? r.area.area.geometry.radiusM : 650;
    return {
      pin: { lon, lat, label: r.label },
      ring: { lon, lat, meters: radius },
      places: r.nearby.map((n) => n.venue.place),
      focus: r.point,
      onMapClick,
    };
  }, [r, onMapClick]);
  useMapOverlay(overlay);

  return (
    <ScreenPanel label="Check an address" testId="address-screen">
      {ex.openPlace ? (
        <PlaceDrawer key={`p-${ex.openPlace.id}`} place={ex.openPlace} />
      ) : (
        <>
          <ScreenTitle
            title="Check an address"
            lead={
              <>Paste the address of a flat you are looking at. Homing finds it, tells you how exactly, and shows the area around it and the everyday places within a short walk.</>
            }
          />

          {selected && !r && (
            <p className="mb-2.5 text-[13px] text-ink-2">
              Checking in <b className="font-[600] text-ink">{areaName(selected.area)}</b>? Any address in {here} works.
            </p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim().length >= 2) check({ query: text.trim() });
            }}
            className="flex gap-2"
          >
            <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-paper-raised px-3 ring-1 ring-line transition-shadow focus-within:ring-2 focus-within:ring-you">
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
            <Button data-testid="address-submit" type="submit" variant="primary" size="md" className="h-11" disabled={f.spot.loading || text.trim().length < 2 || !hasLoves}>
              {f.spot.loading ? <Spinner size={15} /> : <Search size={15} strokeWidth={2} />} Check
            </Button>
          </form>
          <p className="mt-1.5 text-[12.5px] text-ink-3">A street and number in {here}, a place name, or click a spot on the map.</p>

          {f.recentSpots.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-[12.5px] font-[560] text-ink-3">Checked so far</p>
              <div className="flex flex-wrap gap-1.5">
                {f.recentSpots.map((s) => {
                  const on = r?.label === s.result.label;
                  const q = PRECISION_SHORT[s.result.geocodeQuality];
                  return (
                    <button
                      key={s.result.label}
                      onClick={() => (s.stale ? check(s.query ? { query: s.query } : { point: s.result.point }) : f.showSpot(s.result))}
                      className={`flex min-h-8 max-w-full items-center gap-2 rounded-[9px] px-2.5 text-[12.5px] font-[540] transition-colors ${on ? "bg-ink text-paper" : "bg-paper-sunk text-ink-2 hover:text-ink"}`}
                    >
                      <span className="max-w-[170px] truncate">{s.result.label}</span>
                      {q && <span className={on ? "text-paper/70" : "text-ink-3"}>{q}</span>}
                      {s.result.area && <span className={`tnum font-[620] ${on ? "text-paper" : s.stale ? "text-ink-3" : "text-ink-2"}`}>#{s.result.area.metrics.rank}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-5">
            {!hasLoves && (
              <div className="rounded-[18px] bg-paper-sunk/70 p-4 text-[14px] leading-relaxed text-ink-2">
                The places around an address are checked against your taste, so add a few things you love on the Map screen first.
              </div>
            )}

            {f.spot.error && <ErrorNote message={f.spot.error.message} onRetry={f.spot.error.retryable ? () => lastWhere.current && check(lastWhere.current) : undefined} />}

            {f.spot.loading && !r && (
              <div className="space-y-2.5">
                <p className="text-[13.5px] text-ink-2">Finding {f.spot.query ?? "the spot"} and checking the places around it.</p>
                <Skeleton className="h-[170px]" />
                <Skeleton className="h-[200px]" />
              </div>
            )}

            {r && (
              <div className={`transition-opacity ${f.spot.loading ? "opacity-55" : ""}`}>
                {f.spot.loading && (
                  <p className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-3">
                    <RotateCw size={13} className="animate-spin" /> Checking {f.spot.query ?? "again"}
                  </p>
                )}
                <AddressCard view={r} selectedName={selected ? areaName(selected.area) : null} actions={actions} onOpenPlace={(v) => ex.setOpenPlace(v.place)} />
              </div>
            )}

            {hasLoves && !r && !f.spot.loading && !f.spot.error && (
              <div className="rounded-[18px] bg-paper-sunk/70 p-4 text-[14px] leading-relaxed text-ink-2">
                <p>
                  Homing finds the address, says whether it matched the building or only the street, places it in one of the areas it compared in {here}, and lists the cafés, food
                  and culture that pass the checks for your taste within a short walk. It describes the streets around the flat, not the flat itself.
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
                          className="flex min-h-9 items-center gap-1.5 rounded-[11px] bg-paper-raised px-3 text-[13.5px] font-[580] text-ink shadow-[var(--shadow-rest)] ring-1 ring-line transition-transform hover:-translate-y-px"
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
        </>
      )}
    </ScreenPanel>
  );
}
