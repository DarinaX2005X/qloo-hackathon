"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CalendarPlus, Copy, Footprints, Plus, Shuffle } from "lucide-react";
import type { Place } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "./store";
import { Button, Segmented, Skeleton, Spinner } from "@/components/ui/primitives";
import { cityName } from "@/components/ui/CityPicker";
import { download, itineraryToIcs, itineraryToText } from "@/lib/ics";
import { ErrorNote, PlaceCard } from "./ResultsPanel";
import { PlaceDrawer } from "./PlaceDrawer";
import { PlanSettings } from "./TripControls";
import { useIsMobile, useScreenHref } from "./nav";

const enter = { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] as const };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function ExportButtons() {
  const ex = useExplore();
  const [copied, setCopied] = useState(false);
  const plan = ex.plan.data;
  if (!plan) return null;
  const city = cityName(ex.state.city);
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="quiet" onClick={() => download(`homing-${city.toLowerCase().replace(/\s+/g, "-")}.ics`, itineraryToIcs(plan, city), "text/calendar")}>
        <CalendarPlus size={14} /> Calendar
      </Button>
      <Button
        size="sm"
        variant="quiet"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(itineraryToText(plan, city));
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            ex.notify("Your browser blocked the clipboard. Use Calendar instead.");
          }
        }}
      >
        <Copy size={14} /> {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** Saved places that are not in the plan yet, one tap to add each. */
function AddFromSaved() {
  const ex = useExplore();
  const planned = new Set(ex.plan.data?.days.flatMap((d) => d.stops.map((s) => s.place.id)) ?? []);
  const left = ex.saved.filter((p) => !planned.has(p.id));
  if (!ex.plan.data) return null;
  return (
    <section className="mt-6 rounded-[18px] bg-paper-sunk/60 p-3.5">
      <h3 className="text-[14.5px] font-[620] tracking-[-0.01em]">Add a place</h3>
      {left.length ? (
        <>
          <p className="mt-0.5 text-[12.5px] text-ink-2">From your shortlist. Homing finds it a slot that fits its hours.</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {left.slice(0, 8).map((p) => (
              <button
                key={p.id}
                disabled={ex.plan.loading}
                onClick={() => void ex.addToPlan(p)}
                className="flex h-8 max-w-full items-center gap-1 rounded-[9px] bg-paper-raised px-2.5 text-[13px] font-[540] text-ink ring-1 ring-line transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-rest)] disabled:opacity-50"
              >
                <Plus size={13} className="shrink-0 text-you" /> <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">
          {ex.saved.length ? "Everything you saved is already in the plan." : "Save places from a neighborhood on the Map screen and you can add them here, or open any stop and swap it."}
        </p>
      )}
    </section>
  );
}

function Timeline() {
  const ex = useExplore();
  const plan = ex.plan.data;
  if (ex.plan.error && !plan) return <ErrorNote message={ex.plan.error.message} onRetry={() => void ex.makePlan()} />;
  if (ex.plan.loading && !plan)
    return (
      <div className="space-y-3" aria-label="Planning your days">
        <p className="flex items-center gap-2 text-[13.5px] text-ink-2">
          <Spinner size={14} /> Planning around opening hours and walking distance
        </p>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[58px]" />
        ))}
      </div>
    );
  if (!plan) return null;
  const edited = ex.exclude.length + ex.include.length > 0;
  return (
    <div className={`transition-opacity ${ex.plan.loading ? "opacity-60" : ""}`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[19px] font-[650] tracking-[-0.02em]">Day by day</h3>
        <ExportButtons />
      </div>
      {edited && <p className="mb-3 text-[12.5px] text-ink-3">Your edits are kept when you change days, pace or start time.</p>}
      <div className="space-y-3">
        {plan.days.map((d, di) => {
          const on = di === ex.planDay;
          return (
            <section key={di} className={`rounded-[18px] p-3 pb-3.5 ring-1 transition-colors ${on ? "bg-paper-raised ring-[color-mix(in_oklch,var(--you)_28%,transparent)] shadow-[var(--shadow-rest)]" : "bg-transparent ring-line"}`}>
              <button onClick={() => ex.setPlanDay(di)} aria-pressed={on} className="mb-2.5 flex w-full items-baseline justify-between gap-2 text-left">
                <span className="min-w-0">
                  <span className="block text-[15px] font-[630] text-ink">
                    Day {di + 1}
                    {d.weekday ? `, ${cap(d.weekday)}` : ""}
                  </span>
                  <span className="block truncate text-[12.5px] text-ink-2">
                    In {d.neighborhood}, {d.stops.length} stops
                  </span>
                </span>
                <span className={`shrink-0 text-[12px] font-[580] ${on ? "text-you-deep" : "text-ink-3"}`}>{on ? "On the map" : "Show on the map"}</span>
              </button>
              <ol className="relative ml-[22px] border-l-2 border-dashed border-line-strong pl-5">
                <AnimatePresence initial={false}>
                  {d.stops.map((s, si) => (
                    <motion.li
                      data-testid="plan-stop"
                      key={s.place.id}
                      layout
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      transition={{ delay: ex.swapping ? 0 : 0.05 * (si + di * d.stops.length), duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
                      className="group relative pb-4 last:pb-0"
                      onMouseEnter={() => ex.setActivePlace(s.place.id)}
                      onMouseLeave={() => ex.setActivePlace(null)}
                    >
                      <span className={`absolute -left-[31px] top-0.5 grid h-5 w-5 place-items-center rounded-full bg-paper-raised ring-2 ${on ? "ring-ink" : "ring-line-strong"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-you" : "bg-ink-3"}`} />
                      </span>
                      {s.walkMin > 0 && (
                        <span className="mb-1 flex items-center gap-1 text-[11.5px] text-ink-3">
                          <Footprints size={12} /> {s.walkMin} min walk
                        </span>
                      )}
                      <div className="flex items-baseline gap-2.5">
                        <span className="tnum w-11 shrink-0 text-[14px] font-[620] text-ink">{s.time}</span>
                        <button onClick={() => ex.setOpenPlace(s.place)} className="min-w-0 flex-1 text-left">
                          <p className="truncate text-[15px] font-[580] text-ink hover:underline">{s.place.name}</p>
                          <p className="text-[12.5px] text-ink-3">
                            {s.slot}
                            {s.hoursNote === "hours not listed" ? ", hours not listed" : ""}
                            {ex.include.includes(s.place.id) ? ", your pick" : ""}
                          </p>
                        </button>
                        <button
                          onClick={() => void ex.swapStop(s.place.id)}
                          disabled={ex.plan.loading}
                          aria-label={`Swap ${s.place.name} for another place`}
                          className="flex h-7 shrink-0 items-center gap-1 rounded-[8px] px-2 text-[12px] font-[560] text-ink-2 opacity-0 transition-opacity hover:bg-paper-sunk hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40 max-[860px]:opacity-100"
                        >
                          {ex.swapping === s.place.id ? <Spinner size={12} /> : <Shuffle size={13} />} Swap
                        </button>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
              {d.missing.length > 0 && <p className="mt-2 text-[12.5px] text-ink-3">{d.missing.map((m) => (/[.:]/.test(m) ? m : `Nothing open nearby for ${m.toLowerCase()}.`)).join(" ")}</p>}
            </section>
          );
        })}
      </div>
      <AddFromSaved />
    </div>
  );
}

function PlanPanel() {
  const ex = useExplore();
  const href = useScreenHref();
  const hasLoves = activeLoves(ex.state.loves).length > 0;
  const hoods = ex.hoods.data ?? [];
  const first = ex.selected ?? hoods[0];
  const city = cityName(ex.state.city);
  if (ex.openPlace) return <PlaceDrawer key={`p-${ex.openPlace.id}`} place={ex.openPlace} />;
  return (
    <div>
      <h2 className="text-[24px] font-[680] leading-tight tracking-[-0.025em]">Your first days in {city}</h2>
      {!hasLoves ? (
        <div className="mt-2 space-y-3 text-[14.5px] leading-relaxed text-ink-2">
          <p>A plan starts from the neighborhoods that fit your taste. Add a few things you love on the Map screen first, and Homing will plan your days there.</p>
          <Link href={href("/explore")} scroll={false} className="inline-flex items-center gap-1 font-[600] text-you-deep hover:underline">
            Go to the Map <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">
            {first ? (
              <>
                Starting in <b className="font-[620] text-ink">{first.name}</b>
                {ex.state.days > 1 && hoods.length > 1 ? ", then the next neighborhoods that fit you" : ""}. Stops are picked for your taste and checked against opening hours.
              </>
            ) : (
              "Waiting for the ranking of neighborhoods."
            )}
          </p>
          <div className="mt-4 space-y-2">
            <PlanSettings />
            <Button variant={ex.plan.data ? "secondary" : "primary"} size="md" className="w-full" disabled={ex.plan.loading || !hoods.length} onClick={() => void ex.makePlan()}>
              {ex.plan.loading ? <Spinner size={15} /> : <CalendarPlus size={16} strokeWidth={1.9} />}
              {ex.plan.data ? "Plan again" : "Plan my first days"}
            </Button>
          </div>
          <div className="mt-5">
            <Timeline />
          </div>
        </>
      )}
    </div>
  );
}

function SavedPanel() {
  const ex = useExplore();
  const city = cityName(ex.state.city);
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-[20px] font-[650] leading-tight tracking-[-0.02em]">Saved in {city}</h2>
        {ex.saved.length > 0 && <span className="tnum text-[13px] text-ink-3">{ex.saved.length}</span>}
      </div>
      {!ex.saved.length ? (
        <div className="rounded-[16px] bg-paper-sunk/70 p-4 text-[14px] leading-relaxed text-ink-2">
          <p className="font-[600] text-ink">Nothing saved in {city} yet</p>
          <p className="mt-1">Tap the bookmark on any place to keep it here. Then plan your days around the places you picked.</p>
        </div>
      ) : (
        <>
          <Button variant="primary" size="md" className="mb-3 w-full" disabled={ex.plan.loading || !ex.hoods.data?.length} onClick={() => void ex.planWithSaved()}>
            {ex.plan.loading ? <Spinner size={15} /> : <CalendarPlus size={16} />} Plan around these {ex.saved.length}
          </Button>
          <div className="space-y-2">
            {ex.saved.map((p: Place) => (
              <PlaceCard key={p.id} p={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Trip: the plan as a day-by-day timeline next to the shortlist, with the route of the chosen day on the map. */
export function TripScreen() {
  const ex = useExplore();
  const mobile = useIsMobile();
  const [tab, setTab] = useState<"plan" | "saved">("plan");
  if (mobile)
    return (
      <div className="absolute inset-x-0 bottom-0 flex h-[52%] flex-col overflow-hidden rounded-t-[24px] bg-paper-raised shadow-[var(--shadow-overlay)] ring-1 ring-line">
        <div className="px-4 pt-3">
          <Segmented
            label="Trip"
            value={tab}
            onChange={setTab}
            options={[
              { value: "plan", label: "Plan" },
              { value: "saved", label: `Saved${ex.saved.length ? ` ${ex.saved.length}` : ""}` },
            ]}
          />
        </div>
        <div className="hm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-4">{tab === "plan" ? <PlanPanel /> : <SavedPanel />}</div>
      </div>
    );
  return (
    <>
      <motion.aside
        aria-label="Plan"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={enter}
        className="hm-scroll absolute left-4 top-[76px] max-h-[calc(100%-92px)] w-[460px] overflow-y-auto overscroll-contain rounded-[24px] bg-paper-raised/95 px-5 pb-6 pt-5 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur"
      >
        <PlanPanel />
      </motion.aside>
      <motion.aside
        aria-label="Saved places"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ ...enter, delay: 0.06 }}
        className="hm-scroll absolute right-4 top-[76px] max-h-[calc(100%-92px)] w-[360px] overflow-y-auto overscroll-contain rounded-[24px] bg-paper-raised/95 px-5 pb-6 pt-5 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur"
      >
        <SavedPanel />
      </motion.aside>
    </>
  );
}
