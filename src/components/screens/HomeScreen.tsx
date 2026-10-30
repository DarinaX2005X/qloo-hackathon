"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { ArrowRight, House } from "lucide-react";
import type { Neighborhood } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "@/components/explore/store";
import { Button, Segmented, Skeleton, Spinner } from "@/components/ui/primitives";
import { CityPicker, cityName } from "@/components/ui/CityPicker";
import { useFeatures } from "./features";
import { HomeCard } from "./cards";
import { ErrorNote, MapNote, ScreenPanel, ScreenTitle, useMapOverlay, useOpenMap, useSelectNeighborhood } from "./shared";

const SUGGESTIONS = [
  { neighborhood: "Kreuzberg", city: "Berlin" },
  { neighborhood: "Shoreditch", city: "London" },
  { neighborhood: "Williamsburg", city: "New York" },
  { neighborhood: "Le Marais", city: "Paris" },
  { neighborhood: "Shimokitazawa", city: "Tokyo" },
  { neighborhood: "Gràcia", city: "Barcelona" },
];

type Blend = "home" | "mix";

export function HomeScreen() {
  const ex = useExplore();
  const f = useFeatures();
  const here = cityName(ex.state.city);
  const hereKey = here.toLowerCase();
  const suggestions = SUGGESTIONS.filter((s) => s.city.toLowerCase() !== hereKey);
  const [oldCity, setOldCity] = useState(() => f.home.request?.city ?? suggestions[0].city);
  const [hood, setHood] = useState(() => f.home.request?.neighborhood ?? "");
  const [blend, setBlend] = useState<Blend>(() => (f.home.blend > 0 ? "mix" : "home"));
  const [activeId, setActiveId] = useState<string | null>(null);
  const hasLoves = activeLoves(ex.state.loves).length > 0;
  const select = useSelectNeighborhood();
  const openMap = useOpenMap();

  // a result handed in by the assistant fills the form with what it answered
  const req = f.home.request;
  useEffect(() => {
    if (!req) return;
    setOldCity(req.city);
    setHood(req.neighborhood);
  }, [req]);

  const result = f.home.data;
  const run = (src = { city: oldCity, neighborhood: hood }, b: Blend = blend) => {
    if (!src.city.trim() || !src.neighborhood.trim()) return;
    setActiveId(null);
    void f.findHome({ city: src.city, neighborhood: src.neighborhood }, b === "mix" && hasLoves ? 0.5 : 0);
  };

  const byId = useMemo(() => new Map((result?.neighborhoods ?? []).map((n) => [n.id, n])), [result]);
  const top = result?.matches.map((m) => byId.get(m.neighborhoodId)).find(Boolean) ?? result?.neighborhoods[0] ?? null;
  const active = (activeId && byId.get(activeId)) || null;
  const focus = (active ?? top)?.center ?? null;
  const overlay = useMemo(
    () => (result ? { field: result.field, neighborhoods: result.neighborhoods, focus } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, focus?.[0], focus?.[1]],
  );
  useMapOverlay(overlay);

  const pick = (n: Neighborhood) => {
    setActiveId(n.id);
    select(n.id);
  };
  const inRanking = !!active && !!ex.hoods.data?.some((n) => n.id === active.id);

  return (
    <>
      <ScreenPanel label="Feels like home" testId="home-screen">
        <ScreenTitle
          title="Feels like home"
          lead={<>Name a neighborhood you loved living in. Homing reads the places that define it in Qloo and finds where that taste shows up in {here}.</>}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="space-y-2.5"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-2">
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-[560] text-ink-3">City you lived in</span>
              <CityPicker value={oldCity} onChange={setOldCity} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-[560] text-ink-3">Neighborhood</span>
              <input
                data-testid="home-neighborhood"
                value={hood}
                onChange={(e) => setHood(e.target.value)}
                placeholder="Kreuzberg"
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                className="h-10 w-full rounded-[12px] bg-paper-raised px-3 text-[15px] font-[560] text-ink ring-1 ring-line outline-none transition-shadow placeholder:font-[450] placeholder:text-ink-3 focus:ring-2 focus:ring-you"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => {
              const on = s.neighborhood === hood && s.city === oldCity;
              return (
                <button
                  type="button"
                  key={s.neighborhood}
                  onClick={() => {
                    setHood(s.neighborhood);
                    setOldCity(s.city);
                  }}
                  className={`h-7 rounded-[8px] px-2.5 text-[12.5px] font-[540] transition-colors ${on ? "bg-ink text-paper" : "bg-paper-sunk text-ink-2 hover:bg-[color-mix(in_oklch,var(--you)_12%,var(--paper-sunk))] hover:text-ink"}`}
                >
                  {s.neighborhood}
                </button>
              );
            })}
          </div>

          <div className="pt-1.5">
            <span className="mb-1 block text-[12.5px] font-[560] text-ink-3">What shapes the map</span>
            <Segmented
              size="sm"
              label="What shapes the map"
              value={hasLoves ? blend : "home"}
              onChange={(v: Blend) => {
                if (v === "mix" && !hasLoves) return;
                setBlend(v);
                if (result && f.home.request) run(f.home.request, v);
              }}
              options={[
                { value: "home", label: "Old neighborhood only" },
                { value: "mix", label: "Mix in what I love" },
              ]}
            />
            {!hasLoves && <p className="mt-1.5 text-[12px] text-ink-3">Add things you love on the Map screen to mix them in.</p>}
          </div>

          <Button data-testid="home-submit" type="submit" variant="primary" size="md" className="mt-1 w-full" disabled={f.home.loading || !hood.trim() || !oldCity.trim()}>
            {f.home.loading ? <Spinner size={15} /> : <House size={16} strokeWidth={1.9} />}
            {f.home.loading ? `Looking for ${hood.trim() || "it"} in ${here}` : `Find it in ${here}`}
          </Button>
        </form>

        <div className="mt-5">
          {f.home.error && <ErrorNote message={f.home.error.message} onRetry={f.home.error.retryable ? () => run() : undefined} />}

          {f.home.loading && !result && (
            <div className="space-y-2.5">
              <p className="text-[13.5px] leading-snug text-ink-2">
                Reading the places that make {hood.trim() || "the old neighborhood"} what it is, then printing them over {here}. The first time takes a few seconds.
              </p>
              <Skeleton className="h-[132px]" />
              <Skeleton className="h-[150px]" />
              <Skeleton className="h-[120px]" />
            </div>
          )}

          {result && (
            <div className={`transition-opacity ${f.home.loading ? "opacity-55" : ""}`}>
              <HomeCard
                result={result}
                onPick={pick}
                activeId={activeId}
                activeNote={
                  active &&
                  (inRanking ? (
                    <span className="flex items-center justify-between gap-3">
                      <span>Selected on your own map too.</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openMap();
                        }}
                        className="flex shrink-0 items-center gap-1 font-[600] text-you-deep hover:underline"
                      >
                        See its places <ArrowRight size={14} />
                      </button>
                    </span>
                  ) : (
                    <span>Not in your own top neighborhoods yet, so the map flies there.</span>
                  ))
                }
              />
            </div>
          )}

          {!result && !f.home.loading && !f.home.error && (
            <div className="rounded-[18px] bg-paper-sunk/70 p-4 text-[14px] leading-relaxed text-ink-2">
              <p>
                Homing takes the cafés, bars and venues that define your old neighborhood and asks Qloo where people who love the same places gather in {here}. The terrain then shows that taste instead of yours.
              </p>
              <p className="mt-3 text-[12.5px] font-[580] text-ink-3">Try one</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {suggestions.slice(0, 2).map((s) => (
                  <button
                    key={s.neighborhood}
                    onClick={() => {
                      setHood(s.neighborhood);
                      setOldCity(s.city);
                      run(s);
                    }}
                    className="flex h-9 items-center gap-1.5 rounded-[11px] bg-paper-raised px-3 text-[13.5px] font-[580] text-ink shadow-[var(--shadow-rest)] ring-1 ring-line transition-transform hover:-translate-y-px"
                  >
                    I lived in {s.neighborhood}, {s.city} <ArrowRight size={14} className="text-you" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScreenPanel>

      <AnimatePresence>
        {result && (
          <MapNote key="home-note">
            The terrain shows{" "}
            <b className="font-[620] text-ink">
              {result.source.neighborhood}, {cityName(result.source.city)}
            </b>{" "}
            printed over {here}
            {f.home.blend > 0 ? ", mixed with what you love" : ""}.
          </MapNote>
        )}
      </AnimatePresence>
    </>
  );
}
