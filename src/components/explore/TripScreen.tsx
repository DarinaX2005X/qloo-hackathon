"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CalendarPlus, ChevronDown, Copy, Footprints, Plus, Route, Shuffle, X } from "lucide-react";
import type { Itinerary, Place } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "./store";
import { Button, Segmented, Skeleton, Spinner } from "@/components/ui/primitives";
import { cityName } from "@/components/ui/CityPicker";
import { download, itineraryToIcs, itineraryToText } from "@/lib/ics";
import { dayNoteLines } from "@/lib/explain";
import { categoryRuleLabel, stopReasonLines, tagRuleLabel, walkText } from "@/lib/honest";
import { AreaRank } from "@/components/ui/Metric";
import { ConstraintChips, dedupe, ruleKey } from "@/components/agent09/Constraints";
import { RecoveryLog, VisitAudit, VisitStops, visitAreaNames, visitStops } from "@/components/agent09/Visit";
import { useAgentStore } from "@/components/agent09/useAgentStore";
import type { Constraint } from "@/components/agent09/types";
import { constraintLabel } from "@/lib/explain";
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

/** Short plain lines per day instead of a line per empty slot. Never says "closed" unless the backend said so. */
function DayNote({ d, city }: { d: Itinerary["days"][number]; city: string }) {
  const lines = dayNoteLines(d, city);
  if (!lines.length) return null;
  return (
    <ul data-testid="day-note" className="mt-2 space-y-0.5 rounded-[10px] bg-paper-sunk/70 px-2.5 py-1.5 text-[12.5px] leading-snug text-ink-2">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
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
  const city = cityName(ex.state.city);
  const areaOf = (name: string) => ex.analysis.data?.areas.find((a) => a.area.name === name);
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
                  <span className="block text-[12.5px] leading-snug text-ink-2">
                    In {d.neighborhood}
                    {d.stops.length ? `, ${d.stops.length} ${d.stops.length === 1 ? "stop" : "stops"}` : ", no stops"}
                    {areaOf(d.neighborhood) && (
                      <>
                        {" \u00b7 "}
                        <AreaRank metrics={areaOf(d.neighborhood)!.metrics} size="sm" note={false} />
                      </>
                    )}
                  </span>
                </span>
                <span className={`shrink-0 text-[12px] font-[580] ${on ? "text-you-deep" : "text-ink-3"}`}>{on ? "On the map" : "Show on the map"}</span>
              </button>
              <ol className="relative ml-[22px] border-l-2 border-dashed border-line-strong pl-5">
                <AnimatePresence initial={false}>
                  {d.stops.map((s, si) => {
                    const adapted = stopReasonLines(s.reasonCodes);
                    return (
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
                        <span className="mb-1 flex items-center gap-1 text-[11.5px] text-ink-3" title="Straight-line distance, not a route">
                          <Footprints size={12} /> {walkText(s.walkMin, s.walkIsApproximate ?? true)}
                        </span>
                      )}
                      <div className="flex items-baseline gap-2.5">
                        <span className="tnum w-11 shrink-0 text-[14px] font-[620] text-ink">{s.time}</span>
                        <button onClick={() => ex.setOpenPlace(s.place)} className="min-w-0 flex-1 text-left">
                          <p data-testid="plan-stop-name" className="line-clamp-2 text-[15px] font-[580] leading-snug text-ink hover:underline">{s.place.name}</p>
                          <p className="text-[12.5px] text-ink-3">
                            {s.slot}
                            {s.hoursNote === "hours not listed" ? ", hours not listed" : ""}
                            {ex.include.includes(s.place.id) ? ", your pick" : ""}
                          </p>
                          {adapted.length > 0 && (
                            <p data-testid="stop-reason" className="text-[12px] leading-snug text-[color-mix(in_oklch,var(--warn)_55%,var(--ink-2))]">
                              {adapted.join(". ")}.
                            </p>
                          )}
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
                    );
                  })}
                </AnimatePresence>
              </ol>
              <DayNote d={d} city={city} />
            </section>
          );
        })}
      </div>
      <AddFromSaved />
    </div>
  );
}

/** What the current plan was told to leave out or keep, each one a chip that plans again without it. */
function PlanRules() {
  const ex = useExplore();
  const { excludeCategories, excludeTags } = ex.planRules;
  const stops = ex.plan.data?.days.flatMap((d) => d.stops) ?? [];
  const nameOf = (id: string) => stops.find((s) => s.place.id === id)?.place.name ?? ex.saved.find((p) => p.id === id)?.name ?? null;
  const chips = [
    ...excludeCategories.map((c) => ({ key: `c:${c}`, label: categoryRuleLabel(c), remove: () => ex.removePlanRule({ kind: "category", value: c }) })),
    ...excludeTags.map((t) => ({ key: `t:${t}`, label: tagRuleLabel(t), remove: () => ex.removePlanRule({ kind: "tag", value: t }) })),
    ...ex.include.map((id) => ({ key: `i:${id}`, label: `Keep ${nameOf(id) ?? "a place you asked for"}`, remove: () => ex.removePlanRule({ kind: "include", value: id }) })),
  ];
  if (!chips.length) return null;
  return (
    <div data-testid="plan-rules" className="mt-3">
      <p className="text-[12.5px] font-[560] text-ink-3">Kept every time you plan again</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span key={c.key} className="flex h-8 max-w-full items-center gap-1 rounded-[9px] bg-paper-sunk pl-2.5 pr-0.5 text-[13px] font-[560] text-ink">
            <span className="truncate">{c.label}</span>
            <button
              onClick={() => void c.remove()}
              disabled={ex.plan.loading}
              aria-label={`Remove “${c.label}” and plan again`}
              title="Remove and plan again"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-ink-3 hover:bg-paper-raised hover:text-ink disabled:opacity-40"
            >
              <X size={13} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function PlanPanel() {
  const ex = useExplore();
  const href = useScreenHref();
  const hasLoves = activeLoves(ex.state.loves).length > 0;
  const hoods = ex.hoods.data ?? [];
  const first = ex.selected ?? hoods[0];
  return (
    <div>
      <p className="text-[13.5px] leading-relaxed text-ink-2">A longer plan of one to three days, starting from your shortlist.</p>
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
            {ex.planFrom === "assistant" && ex.plan.data ? (
              <>
                This plan came from the assistant, starting in <b className="font-[620] text-ink">{ex.plan.data.days[0]?.neighborhood}</b>. Times include approximate walking and are checked against opening hours where Qloo lists them. Plan again starts over from your ranking{ex.planRules.excludeCategories.length + ex.planRules.excludeTags.length + ex.include.length ? " and keeps the rules below" : ""}.
              </>
            ) : first ? (
              <>
                Starting in <b className="font-[620] text-ink">{first.name}</b>
                {ex.state.days > 1 && hoods.length > 1 ? ", then the next neighborhoods that fit you" : ""}. Stops are picked for your taste; times include approximate walking and are checked against opening hours where Qloo lists them.
              </>
            ) : (
              "Waiting for the ranking of neighborhoods."
            )}
          </p>
          <PlanRules />
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
        <h2 className="sr-only">Saved in {city}</h2>
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

/** Rules a person can add in one tap; each is a hard rule the walk and the assistant keep. */
const QUICK_RULES: Constraint[] = [
  { id: "ui:no-bars", kind: "exclude_type", value: "bars", strength: "hard", source: "user" },
  { id: "ui:no-museums", kind: "exclude_type", value: "museums", strength: "hard", source: "user" },
  { id: "ui:budget-2", kind: "budget", value: 2, strength: "hard", source: "user" },
  { id: "ui:vegetarian", kind: "dietary", value: "vegetarian", strength: "hard", source: "user" },
];

/** The rules this walk keeps, removable, plus a few one-tap rules to add. */
function VisitRules() {
  const ex = useAgentStore();
  const list = dedupe(ex.constraints ?? []);
  const names = Object.fromEntries((ex.visit?.data ? visitStops(ex.visit.data) : []).map((st) => [st.place.id, st.place.name]));
  const add = QUICK_RULES.filter((q) => !list.some((c) => ruleKey(c) === ruleKey(q)));
  if (!ex.setConstraint) return null;
  return (
    <section className="mt-3" data-testid="visit-rules">
      {list.length > 0 ? (
        <ConstraintChips
          constraints={list}
          names={names}
          label="Kept every time you plan again"
          onRemove={ex.removeConstraint ? (c) => ex.removeConstraint!(c.id) : undefined}
          disabled={ex.visit?.loading}
        />
      ) : (
        <p className="text-[12.5px] font-[560] text-ink-3">No rules yet. Add one and every plan, swap and assistant answer keeps it.</p>
      )}
      {add.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {add.map((q) => (
            <button
              key={q.id}
              onClick={() => ex.setConstraint!(q)}
              disabled={ex.visit?.loading}
              className="flex h-8 items-center gap-1 rounded-[9px] bg-paper-sunk px-2.5 text-[13px] font-[520] text-ink-2 transition-colors hover:bg-[color-mix(in_oklch,var(--you)_12%,var(--paper-sunk))] hover:text-ink disabled:opacity-50"
            >
              <Plus size={13} /> {constraintLabel(q)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** When the walk starts: the same area at another time of day, the rules and the current stops kept where they still fit. */
const TIMES = [
  { value: "10", label: "Morning" },
  { value: "14", label: "Afternoon" },
  { value: "18", label: "Evening" },
] as const;
type TimeValue = (typeof TIMES)[number]["value"];
const nearestTime = (h: number | undefined): TimeValue => {
  const x = h ?? 14;
  return TIMES.reduce((best, t) => (Math.abs(Number(t.value) - x) < Math.abs(Number(best.value) - x) ? t : best), TIMES[1] as (typeof TIMES)[number]).value;
};

/** "Try this neighborhood": one calm walk of three or four places in an area from the shortlist (§13.4). */
function VisitPanel() {
  const ex = useAgentStore();
  const href = useScreenHref();
  const [swapping, setSwapping] = useState<string | null>(null);
  const v = ex.visit;
  const areas = ex.analysis.data?.areas ?? [];
  const hasLoves = activeLoves(ex.state.loves).length > 0;
  const current = v?.areaIds[0] ?? ex.state.neighborhood ?? areas[0]?.area.id ?? null;
  const area = areas.find((a) => a.area.id === current) ?? null;
  const name = area?.area.name ?? (v?.data ? visitAreaNames(v.data)[0] : null) ?? null;
  const top = areas.slice(0, 3);
  const choices = area && !top.includes(area) ? [...top, area] : top;
  if (!v || !ex.buildVisit) return null;
  const build = (id: string) => void ex.buildVisit!(id, id === v.areaIds[0] ? { excludeIds: v.excludeIds } : {});
  const run = async (fn: ((id: string) => Promise<void>) | undefined, id: string) => {
    if (!fn) return;
    setSwapping(id);
    try {
      await fn(id);
    } finally {
      setSwapping(null);
    }
  };
  const stops = v.data ? visitStops(v.data) : [];
  const dayAreas = v.data ? visitAreaNames(v.data) : [];
  const moved = !!(v.data && name && dayAreas.some((n) => n !== name));
  return (
    <div data-testid="visit-panel">
      <h2 className="text-[24px] font-[680] leading-tight tracking-[-0.025em]">{name ? `Try ${name}` : "Try a neighborhood"}</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">
        A short walk of three or four places, enough to check the coffee, the food and the culture before you look at flats here.
      </p>
      {!hasLoves && !areas.length && !v.data ? (
        <div className="mt-3 space-y-2 text-[14px] leading-relaxed text-ink-2">
          <p>A walk starts from an area on your shortlist. Add a few things you love on the Map first.</p>
          <Link href={href("/explore")} scroll={false} className="inline-flex items-center gap-1 font-[600] text-you-deep hover:underline">
            Go to the Map <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <>
          {choices.length > 1 && (
            <div className="mt-3" role="radiogroup" aria-label="Area to try">
              <p className="text-[12.5px] font-[560] text-ink-3">Area from your shortlist</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {choices.map((a) => {
                  const on = a.area.id === current;
                  return (
                    <button
                      key={a.area.id}
                      role="radio"
                      aria-checked={on}
                      disabled={v.loading}
                      onClick={() => !on && build(a.area.id)}
                      className={`flex h-9 max-w-full items-center gap-2 rounded-[10px] px-3 text-[13.5px] font-[580] transition-colors disabled:opacity-60 ${on ? "bg-ink text-paper" : "bg-paper-sunk text-ink-2 hover:text-ink"}`}
                    >
                      <span className="tnum text-[12px] opacity-70">#{a.metrics.rank}</span>
                      <span className="truncate">{a.area.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <VisitRules />
          <div className="mt-3 flex items-center gap-3" data-testid="visit-time">
            <span className="w-[86px] shrink-0 text-[12.5px] font-[560] leading-tight text-ink-3">
              Starts at <span className="tnum text-ink-2">{String(v.startHour ?? 14).padStart(2, "0")}:00</span>
            </span>
            <div className="min-w-0 flex-1">
              <Segmented
                size="sm"
                label="When the walk starts"
                value={nearestTime(v.startHour)}
                onChange={(t) => {
                  if (!current || v.loading) return;
                  const hour = Number(t);
                  // same area and rules, every place the person removed stays out; the stops are picked again for the new
                  // hour (forcing the old ones in leaves a café that closes at 17:00 in an evening walk)
                  void ex.buildVisit!(current, { startHour: hour, excludeIds: v.areaIds[0] === current ? v.excludeIds : [] });
                }}
                options={TIMES.map((t) => ({ value: t.value, label: t.label }))}
              />
            </div>
          </div>
          <div className="mt-4">
            <Button
              variant={v.data ? "secondary" : "primary"}
              size="md"
              className="w-full"
              disabled={v.loading || !current}
              onClick={() => current && build(current)}
              data-testid="visit-plan"
            >
              {v.loading && !swapping ? <Spinner size={15} /> : <Route size={16} strokeWidth={1.9} />}
              {v.data ? "Plan again" : "Plan a walk here"}
            </Button>
          </div>
          <div className="mt-5" aria-busy={v.loading}>
            {v.error && !v.data && <ErrorNote message={v.error.message} onRetry={current ? () => build(current) : undefined} />}
            {v.loading && !v.data && (
              <div className="space-y-3" aria-label="Planning the walk">
                <p className="flex items-center gap-2 text-[13.5px] text-ink-2">
                  <Spinner size={14} /> Picking places that pass your rules
                </p>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[58px]" />
                ))}
              </div>
            )}
            {v.data && (
              <div className={`space-y-3 transition-opacity ${v.loading ? "opacity-60" : ""}`} data-testid="visit-result">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[17px] font-[650] tracking-[-0.02em]">
                    {stops.length} {stops.length === 1 ? "stop" : "stops"}
                    {dayAreas.length ? <span className="font-[450] text-ink-2"> in {dayAreas.join(" and ")}</span> : null}
                  </h3>
                  {v.from === "assistant" && <span className="shrink-0 text-[12px] text-ink-3">From the assistant</span>}
                </div>
                {v.stale && (
                  <p className="rounded-[10px] bg-paper-sunk px-3 py-2 text-[13px] text-ink-2" data-testid="visit-stale">
                    Your tastes or rules changed after this walk was planned. Plan again to check it against them.
                  </p>
                )}
                {moved && <p className="text-[13px] text-ink-2">Part of this walk is in another area; nothing closer to {name} passed your rules.</p>}
                {v.error && <p className="text-[13px] text-[var(--err)]">{v.error.message}</p>}
                <VisitAudit result={v.data} />
                <RecoveryLog result={v.data} />
                <VisitStops
                  result={v.data}
                  busy={v.loading}
                  swapping={swapping}
                  onSwap={ex.swapVisitStop ? (id) => void run(ex.swapVisitStop, id) : undefined}
                  onRemove={ex.removeVisitStop ? (id) => void run(ex.removeVisitStop, id) : undefined}
                  onHover={ex.setActivePlace}
                />
                <p className="text-[11.5px] text-ink-3">Times include approximate walking. Swap keeps the other stops; a removed place is not suggested again.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Fold({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-6 border-t border-line pt-3" data-testid={testId}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-9 w-full items-center gap-1.5 text-left text-[14.5px] font-[620] text-ink">
        <ChevronDown size={15} className={`transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
        {title}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function TryPanel() {
  const ex = useExplore();
  if (ex.openPlace) return <PlaceDrawer key={`p-${ex.openPlace.id}`} place={ex.openPlace} />;
  return (
    <>
      <VisitPanel />
      <Fold title={`Saved places${ex.saved.length ? ` (${ex.saved.length})` : ""}`} testId="saved-fold">
        <SavedPanel />
      </Fold>
      <Fold title="Plan up to three days" testId="long-plan-fold">
        <PlanPanel />
      </Fold>
    </>
  );
}

/** Try this neighborhood: one short walk with its rules; the longer plan and the saved places fold away below. */
export function TripScreen() {
  const ex = useAgentStore();
  const mobile = useIsMobile();
  const hasVisit = !!ex.visit?.data;
  const setPlanDay = ex.setPlanDay;
  useEffect(() => {
    if (hasVisit) setPlanDay(0);
  }, [hasVisit, setPlanDay]);
  if (mobile)
    return (
      <div className="absolute inset-x-0 bottom-0 flex h-[52%] flex-col overflow-hidden rounded-t-[24px] bg-paper-raised shadow-[var(--shadow-overlay)] ring-1 ring-line">
        <div className="hm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-4">
          <TryPanel />
        </div>
      </div>
    );
  return (
    <motion.aside
      aria-label="Try this neighborhood"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={enter}
      className="hm-scroll absolute left-4 top-[76px] max-h-[calc(100%-92px)] w-[460px] overflow-y-auto overscroll-contain rounded-[24px] bg-paper-raised/95 px-5 pb-6 pt-5 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur"
    >
      <TryPanel />
    </motion.aside>
  );
}
