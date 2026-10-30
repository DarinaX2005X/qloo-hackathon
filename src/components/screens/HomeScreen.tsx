"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { ArrowRight, House, RotateCw } from "lucide-react";
import type { HomeMatchV2 } from "@/shared/contracts-09";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "@/components/explore/store";
import { Button, Segmented, Skeleton, Spinner } from "@/components/ui/primitives";
import { CityPicker, cityName } from "@/components/ui/CityPicker";
import { HOME_BLEND_LAMBDA, useFeatures } from "./features";
import { HomeMatchesCard } from "./decision";
import { useGoTo } from "@/components/explore/nav";
import { areaName } from "./venue";
import { ErrorNote, MapNote, ScreenPanel, ScreenTitle, platesOf, useAreaActions, useMapOverlay } from "./shared";

const SUGGESTIONS = [
  { neighborhood: "Kreuzberg", city: "Berlin" },
  { neighborhood: "Alfama", city: "Lisbon" },
  { neighborhood: "Shoreditch", city: "London" },
  { neighborhood: "Williamsburg", city: "New York" },
  { neighborhood: "Le Marais", city: "Paris" },
  { neighborhood: "Shimokitazawa", city: "Tokyo" },
];

type Order = "home" | "mix";

/** `?from=<old city>&hood=<old neighborhood>` from the landing's "A neighborhood I loved", read once. */
function landingSource(): { city: string; neighborhood: string } | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const city = q.get("from")?.trim().slice(0, 80);
  const neighborhood = q.get("hood")?.trim().slice(0, 80);
  return city && neighborhood ? { city, neighborhood } : null;
}

export function HomeScreen() {
  const ex = useExplore();
  const f = useFeatures();
  const actions = useAreaActions();
  const goTo = useGoTo();
  const here = cityName(ex.state.city);
  const [oldCity, setOldCity] = useState(() => f.home.request?.city ?? "Berlin");
  const [hood, setHood] = useState(() => f.home.request?.neighborhood ?? "");
  const [order, setOrder] = useState<Order>(() => (f.home.lambda > 0 ? "mix" : "home"));
  const [activeId, setActiveId] = useState<string | null>(null);
  const hasLoves = activeLoves(ex.state.loves).length > 0;

  // a result handed in by the assistant fills the form with what it answered
  const req = f.home.request;
  useEffect(() => {
    if (!req) return;
    setOldCity(req.city);
    setHood(req.neighborhood);
  }, [req]);

  const run = (src = { city: oldCity, neighborhood: hood }, o: Order = order) => {
    if (!src.city.trim() || !src.neighborhood.trim()) return;
    setActiveId(null);
    void f.findHome({ city: src.city, neighborhood: src.neighborhood }, o === "mix" && hasLoves ? HOME_BLEND_LAMBDA : 0);
  };

  // the landing handed a source in: read it before the store rewrites the URL (a child's effect runs first),
  // then run it once the state is in place
  const fromLanding = useRef<{ city: string; neighborhood: string } | null | undefined>(undefined);
  useEffect(() => {
    fromLanding.current = landingSource();
    if (!fromLanding.current) return;
    setOldCity(fromLanding.current.city);
    setHood(fromLanding.current.neighborhood);
  }, []);
  const ranLanding = useRef(false);
  useEffect(() => {
    if (!fromLanding.current || ranLanding.current || !ex.hydrated) return;
    ranLanding.current = true;
    run(fromLanding.current, "home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.hydrated]);

  // Home + your taste depends on the loves: recompute when they change
  useEffect(() => {
    if (f.home.stale && !f.home.loading && f.home.request) run(f.home.request, "mix");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.home.stale]);

  const view = f.home.data;
  const matches = useMemo(() => view?.matches ?? [], [view]);
  const active = matches.find((m) => m.area.area.id === activeId) ?? null;
  const focus = (active ?? matches[0])?.area.area.center ?? null;
  const overlay = useMemo(
    () => (view ? { field: view.field ?? null, neighborhoods: platesOf(matches.map((m) => m.area)), focus } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, matches, focus?.[0], focus?.[1]],
  );
  useMapOverlay(overlay);

  const pick = (m: HomeMatchV2) => {
    setActiveId((id) => (id === m.area.area.id ? null : m.area.area.id));
    if (ex.analysis.data?.areas.some((a) => a.area.id === m.area.area.id)) ex.patch([{ op: "select_neighborhood", id: m.area.area.id }]);
  };
  const src = view?.sourceSignatureSummary;

  return (
    <>
      <ScreenPanel label="Feels like home" testId="home-screen">
        <ScreenTitle
          title="Feels like home"
          lead={<>Name a neighborhood you loved living in. Homing reads the places that define it and finds the areas of {here} with the closest cultural profile.</>}
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
            {SUGGESTIONS.map((s) => {
              const on = s.neighborhood === hood && s.city === oldCity;
              return (
                <button
                  type="button"
                  key={s.neighborhood}
                  onClick={() => {
                    setHood(s.neighborhood);
                    setOldCity(s.city);
                  }}
                  className={`h-8 rounded-[8px] px-2.5 text-[12.5px] font-[540] transition-colors ${on ? "bg-ink text-paper" : "bg-paper-sunk text-ink-2 hover:bg-[color-mix(in_oklch,var(--them)_12%,var(--paper-sunk))] hover:text-ink"}`}
                >
                  {s.neighborhood}
                </button>
              );
            })}
          </div>

          <div className="pt-1.5">
            <span className="mb-1 block text-[12.5px] font-[560] text-ink-3">Order the areas by</span>
            <Segmented
              size="sm"
              label="Order the areas by"
              value={hasLoves ? order : "home"}
              onChange={(v: Order) => {
                if (v === "mix" && !hasLoves) return;
                setOrder(v);
                if (view && f.home.request) run(f.home.request, v);
              }}
              options={[
                { value: "home", label: "Closest to home" },
                { value: "mix", label: "Home + your taste" },
              ]}
            />
            {!hasLoves && <p className="mt-1.5 text-[12px] text-ink-3">Add things you love on the Map screen to mix them in.</p>}
          </div>

          <Button data-testid="home-submit" type="submit" variant="primary" size="md" className="mt-1 w-full" disabled={f.home.loading || !hood.trim() || !oldCity.trim()}>
            {f.home.loading ? <Spinner size={15} /> : <House size={16} strokeWidth={1.9} />}
            {f.home.loading ? `Reading ${hood.trim() || "it"}, then ${here}` : `Find it in ${here}`}
          </Button>
        </form>

        <div className="mt-5">
          {f.home.error && <ErrorNote message={f.home.error.message} onRetry={f.home.error.retryable ? () => run() : undefined} />}

          {f.home.loading && !view && (
            <div className="space-y-2.5">
              <p className="text-[13.5px] leading-snug text-ink-2">
                Finding the places that define {hood.trim() || "the old neighborhood"}, then comparing the areas of {here} with them. The first time takes a few seconds.
              </p>
              <Skeleton className="h-[150px]" />
              <Skeleton className="h-[140px]" />
              <Skeleton className="h-[120px]" />
            </div>
          )}

          {view && (
            <div className={`transition-opacity ${f.home.loading ? "opacity-55" : ""}`}>
              {f.home.loading && (
                <p className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-3">
                  <RotateCw size={13} className="animate-spin" /> Checking again
                </p>
              )}
              <HomeMatchesCard
                view={view}
                activeId={activeId}
                onPick={pick}
                actions={actions}
                onBlend={
                  hasLoves && f.home.request
                    ? () => {
                        setOrder("mix");
                        run(f.home.request!, "mix");
                      }
                    : undefined
                }
                onAddLoves={hasLoves ? undefined : () => goTo("/explore")}
              />
            </div>
          )}

          {!view && !f.home.loading && !f.home.error && (
            <div className="rounded-[18px] bg-paper-sunk/70 p-4 text-[14px] leading-relaxed text-ink-2">
              <p>
                Homing takes the cafés, food, bars and culture of your old neighborhood, finds what sets them apart, and looks for the areas of {here} whose places share it. You get the closest areas, what they share, and a place to try in each.
              </p>
              <p className="mt-3 text-[12.5px] font-[580] text-ink-3">Try one</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {SUGGESTIONS.slice(0, 2).map((s) => (
                  <button
                    key={s.neighborhood}
                    onClick={() => {
                      setHood(s.neighborhood);
                      setOldCity(s.city);
                      run(s);
                    }}
                    className="flex min-h-9 items-center gap-1.5 rounded-[11px] bg-paper-raised px-3 text-[13.5px] font-[580] text-ink shadow-[var(--shadow-rest)] ring-1 ring-line transition-transform hover:-translate-y-px"
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
        {view && src && matches[0] && (
          <MapNote key="home-note">
            Numbered by closeness to <b className="font-[620] text-ink">{src.area.name}</b>
            {matches[0].orderReason === "home_personal_blend" ? " and your taste" : ""}. #1 is {areaName(matches[0].area.area)}.
          </MapNote>
        )}
      </AnimatePresence>
    </>
  );
}
