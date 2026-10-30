"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ChevronDown, CircleAlert, Footprints, Info, MapPin } from "lucide-react";
import type { AblationV2, AreaDecision, Claim, HomeMatchV2, SourceSignatureSummary, VenueEvidence, VenueRole } from "@/shared/contracts-09";
import { AreaRank, HomeOverlap, SupportTag } from "@/components/ui/Metric";
import { OVERLAP_EXPLAINER, overlapText } from "@/lib/honest";
import { cityName } from "@/components/ui/CityPicker";
import { Button } from "@/components/ui/primitives";
import { ROLE_PLURAL, SourcePlaceChip, VenueRow, areaName, areaScale, bestConnection, connectionLine, useLoveName } from "./venue";
import type { AddressView, ComparisonView, ExplainView, HomeView } from "./features";
import { counterfactual, moveText } from "./ablation";
export { counterfactual, movesOutsideTie } from "./ablation";

const SPRING = { type: "spring" as const, stiffness: 380, damping: 34 };
/** Below this overlap the closest area is still a weak match; the same operational threshold the agent uses (§9 scenario 2). */
export const WEAK_OVERLAP = 35;
/** The answer is a short list: three areas first, the rest behind one tap (§13.2). */
const FIRST = 3;

function joinWords(list: string[]) {
  if (list.length < 2) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** A line that opens a definition, so a number's meaning is one tap away on a phone too. */
export function Definition({ label, text, className = "" }: { label: string; text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-8 items-center gap-1 rounded-[7px] text-[12.5px] font-[560] text-ink-3 hover:text-ink">
        <Info size={13} /> {label}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.p
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden text-[12.5px] leading-snug text-ink-2"
          >
            <span className="block pt-1">{text}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

export type AreaActions = {
  /** select the area on the map and show its places */
  onOpen?: (area: AreaDecision) => void;
  onCheckAddress?: (area: AreaDecision) => void;
  onTry?: (area: AreaDecision) => void;
};

function ActionRow({ area, actions }: { area: AreaDecision; actions?: AreaActions }) {
  if (!actions) return null;
  const btn = "flex min-h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-[600] transition-colors";
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {actions.onTry && (
        <button onClick={() => actions.onTry!(area)} className={`${btn} bg-ink text-paper hover:bg-[color-mix(in_oklch,var(--ink)_88%,var(--you))]`}>
          <Footprints size={14} /> Try this area
        </button>
      )}
      {actions.onCheckAddress && (
        <button onClick={() => actions.onCheckAddress!(area)} className={`${btn} bg-paper-sunk text-ink hover:bg-line`}>
          <MapPin size={14} /> Check an address here
        </button>
      )}
      {actions.onOpen && (
        <button onClick={() => actions.onOpen!(area)} className={`${btn} text-you-deep hover:bg-you-soft`}>
          See its places <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Feels like home

function SourceBlock({ src, compact }: { src: SourceSignatureSummary; compact?: boolean }) {
  const style = src.features.filter((f) => f.family === "placeStyle").slice(0, 4);
  const music = src.features.filter((f) => f.family === "musicTaste").slice(0, 3);
  const cats = Object.entries(src.categoryCounts).filter(([, n]) => n > 0).length;
  return (
    <section data-testid="home-source" className="rounded-[20px] bg-[color-mix(in_oklch,var(--them)_7%,var(--paper-raised))] p-4 ring-1 ring-[color-mix(in_oklch,var(--them)_22%,transparent)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-[580] text-[color-mix(in_oklch,var(--them)_70%,var(--ink))]">Where you lived</p>
          <h3 className="mt-0.5 text-[20px] font-[660] leading-tight tracking-[-0.02em]">
            {areaName(src.area)}, {cityName(src.cityName)}
          </h3>
        </div>
        <SupportTag quality={src.support} />
      </div>
      <p data-testid="home-source-scale" className="mt-1 text-[12.5px] leading-snug text-ink-3">
        {areaScale(src.area)} · {src.venueCount} {src.venueCount === 1 ? "place" : "places"} in {cats} {cats === 1 ? "kind" : "kinds"}
      </p>
      {!compact && (style.length > 0 || music.length > 0) && (
        <div className="mt-2.5">
          <p className="text-[12.5px] font-[560] text-ink-3">What sets its places apart in Qloo</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {[...style, ...music].map((f) => (
              <span key={f.tagId} className="inline-flex h-6 items-center rounded-[7px] bg-them-soft px-2 text-[12.5px] font-[560] text-[color-mix(in_oklch,var(--them)_70%,var(--ink))]">
                {f.family === "musicTaste" ? `${f.label} music` : f.label.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      )}
      {src.representatives.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {src.representatives.slice(0, compact ? 4 : 6).map((v) => (
            <SourcePlaceChip key={v.venueKey} v={v} />
          ))}
        </div>
      )}
      {!compact && src.missingFamilies.length > 0 && (
        <p className="mt-2.5 text-[12px] leading-snug text-ink-3">
          {src.missingFamilies.includes("musicTaste")
            ? "No music links for these places, so the comparison uses the style of the places only."
            : `Missing: ${src.missingFamilies.join(", ")}.`}
        </p>
      )}
    </section>
  );
}

/** Old place → shared feature → a place here. Teal is the old neighborhood, vermilion the new city. */
function CounterpartChain({ from, to, shared }: { from: VenueEvidence | null; to: VenueEvidence; shared: string[] }) {
  return (
    <div className="relative pl-1">
      <span className="absolute bottom-[22px] left-[19px] top-[22px] w-px bg-[linear-gradient(var(--them),var(--you))] opacity-50" aria-hidden />
      {from ? <VenueRow v={from} tone="them" compact note={<span className="text-ink-3">In your old neighborhood</span>} /> : null}
      {shared.length > 0 && (
        <p className="relative ml-[42px] py-0.5 text-[12px] text-ink-3">
          Both: <span className="font-[580] text-ink-2">{shared.join(", ")}</span>
        </p>
      )}
      <VenueRow v={to} compact note={from ? <>A place to try if you loved {from.place.name}</> : <>A place to try here</>} />
    </div>
  );
}

function HomeMatchItem({
  m,
  i,
  src,
  active,
  onPick,
  actions,
}: {
  m: HomeMatchV2;
  i: number;
  src?: SourceSignatureSummary;
  active: boolean;
  onPick?: (m: HomeMatchV2) => void;
  actions?: AreaActions;
}) {
  const reps = new Map((src?.representatives ?? []).map((v) => [v.place.id, v]));
  const labels = m.sharedFeatures.map((f) => f.label);
  const labelOf = new Map<string, string>([...(src?.features ?? []).map((f) => [f.tagId, f.label] as [string, string]), ...m.sharedFeatures.map((f) => [f.tagId, f.label] as [string, string])]);
  const sharedOf = (v: VenueEvidence) => [...new Set(v.connections.flatMap((x) => x.sharedTagIds).map((id) => labelOf.get(id)).filter((x): x is string => !!x))].slice(0, 2);
  const limited = m.similarity.support !== "sufficient" || m.area.metrics.support.quality !== "sufficient";
  return (
    <motion.li initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: i * 0.06 }}>
      <div
        role={onPick ? "button" : undefined}
        tabIndex={onPick ? 0 : undefined}
        aria-pressed={onPick ? active : undefined}
        data-testid="home-match"
        onClick={() => onPick?.(m)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick && e.target === e.currentTarget && (e.preventDefault(), onPick(m))}
        className={`rounded-[18px] p-3.5 ring-1 transition-[transform,box-shadow] duration-150 ${onPick ? "cursor-pointer hover:-translate-y-px hover:shadow-[var(--shadow-raised)]" : ""} ${i === 0 ? "bg-[color-mix(in_oklch,var(--you)_6%,var(--paper-raised))]" : "bg-paper-raised"} ${active ? "shadow-[var(--shadow-raised)] ring-2 ring-ink" : i === 0 ? "ring-[color-mix(in_oklch,var(--you)_28%,transparent)]" : "ring-line"}`}
      >
        <div className="flex items-start gap-3">
          <span className={`tnum grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[13px] font-[650] ${i === 0 ? "bg-you text-white" : "bg-paper-sunk text-ink-2"}`}>{i + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-[630] tracking-[-0.015em]">{areaName(m.area.area)}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <HomeOverlap similarity={m.similarity} />
              {limited && <SupportTag quality={m.similarity.support === "sufficient" ? m.area.metrics.support.quality : m.similarity.support} />}
            </span>
          </span>
        </div>
        {m.similarity.value !== null && m.similarity.support === "sufficient" && (
          <div className="ml-10 mt-2 h-1.5 overflow-hidden rounded-full bg-paper-sunk" aria-hidden>
            <motion.div className="h-full rounded-full bg-you" initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, m.similarity.value))}%` }} transition={{ duration: 0.7, delay: 0.1 + i * 0.06, ease: [0.2, 0.8, 0.2, 1] }} />
          </div>
        )}
        {labels.length > 0 && (
          <p className="ml-10 mt-2 text-[13px] leading-snug text-ink-2">
            Shares <span className="font-[600] text-ink">{joinWords(labels.slice(0, 2).map((l) => l.toLowerCase()))}</span> with {src ? src.area.name : "your old neighborhood"}
            {labels.length > 2 ? <span className="text-ink-3">, and {labels.length - 2} more</span> : null}.
          </p>
        )}
        <div className="mt-2.5 space-y-2">
          {m.counterparts.length > 0 ? (
            (active ? m.counterparts.slice(0, 2) : m.counterparts.slice(0, 1)).map((c) => (
              <CounterpartChain key={`${c.sourcePlaceId}-${c.target.venueKey}`} from={reps.get(c.sourcePlaceId) ?? null} to={c.target} shared={sharedOf(c.target)} />
            ))
          ) : (
            <p className="ml-10 text-[12.5px] text-ink-3">No close counterpart found for a place from home.</p>
          )}
        </div>
        {active && <ActionRow area={m.area} actions={actions} />}
      </div>
    </motion.li>
  );
}

/**
 * Feels like home, v2: the old neighborhood, then the closest areas here in the order the heading names,
 * each with its shared features and a place to try. One number per area: the cultural-profile overlap.
 */
export function HomeMatchesCard({
  view,
  compact = false,
  activeId,
  onPick,
  actions,
  onBlend,
  onAddLoves,
}: {
  view: HomeView;
  compact?: boolean;
  activeId?: string | null;
  onPick?: (m: HomeMatchV2) => void;
  actions?: AreaActions;
  /** offered when the closest area is a weak match and the person has loves to mix in */
  onBlend?: () => void;
  /** offered instead when there are no loves to mix in yet */
  onAddLoves?: () => void;
}) {
  const src = view.sourceSignatureSummary;
  const ms = view.matches;
  const blended = ms[0]?.orderReason === "home_personal_blend";
  const top = ms[0];
  const weak = !!top && top.similarity.value !== null && top.similarity.support === "sufficient" && top.similarity.value < WEAK_OVERLAP && !blended;
  const srcName = src ? src.area.name : "your old neighborhood";
  const [all, setAll] = useState(false);
  const activeAt = ms.findIndex((m) => m.area.area.id === activeId);
  const shown = all || activeAt >= FIRST ? ms : ms.slice(0, FIRST);

  if (compact) {
    return (
      <div data-testid="home-card" className="rounded-[18px] bg-paper-raised p-3.5 ring-1 ring-line">
        <p className="text-[12.5px] font-[560] text-ink-3">
          {blended ? "Home + your taste" : "Closest to"} {src ? `${src.area.name}, ${cityName(src.cityName)}` : "your old neighborhood"}
        </p>
        {top ? (
          <>
            <p className="mt-1 truncate text-[18px] font-[650] tracking-[-0.02em]">{areaName(top.area.area)}</p>
            <HomeOverlap similarity={top.similarity} />
            {top.counterparts[0] && (
              <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">
                Try <b className="font-[600] text-ink">{top.counterparts[0].target.place.name}</b>
                {src?.representatives.find((v) => v.place.id === top.counterparts[0].sourcePlaceId) && (
                  <> if you loved {src.representatives.find((v) => v.place.id === top.counterparts[0].sourcePlaceId)!.place.name}</>
                )}
                .
              </p>
            )}
            {ms.length > 1 && (
              <p className="mt-1.5 text-[12.5px] text-ink-3">
                Then {joinWords(ms.slice(1, 3).map((m) => `${areaName(m.area.area)}${overlapText(m.similarity) ? ` (${Math.round(m.similarity.value!)}/100)` : ""}`))}.
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-[13.5px] text-ink-2">No area here had enough data to compare.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      {src && <SourceBlock src={src} />}
      <h3 data-testid="home-order" data-order={blended ? "home_personal_blend" : "home_similarity"} className="mt-5 text-[16px] font-[650] tracking-[-0.01em]">
        {blended ? "Home + your taste" : "Closest to your old neighborhood"}
      </h3>
      <p className="mb-2.5 mt-0.5 text-[12.5px] leading-snug text-ink-3">
        {blended
          ? `Ordered by a balance of how close each area is to ${srcName} and how it ranks for your own loves. The overlap numbers are unchanged.`
          : `Ordered by cultural-profile overlap with ${srcName}, highest first. The closest area can still be a weak match.`}
      </p>
      {!ms.length && <p className="text-[14px] text-ink-2">No area here had enough data to compare. Try a neighborhood with more places, or mix in what you love.</p>}
      {weak && (
        <div data-testid="home-weak" className="mb-2.5 rounded-[14px] bg-paper-sunk/80 px-3.5 py-2.5 text-[13px] leading-snug text-ink-2">
          Even the closest area here is a weak match for {srcName}, so treat these as places to start looking.
          {onBlend ? (
            <>
              {" "}Your own loves can sharpen the order.
              <span className="mt-2 block">
                <Button data-testid="home-weak-blend" variant="primary" size="sm" onClick={onBlend}>
                  Mix in what you love
                </Button>
              </span>
            </>
          ) : onAddLoves ? (
            <>
              {" "}Add a few things you love, then mix them in here.
              <span className="mt-2 block">
                <Button data-testid="home-weak-add" variant="primary" size="sm" onClick={onAddLoves}>
                  Add what you love
                </Button>
              </span>
            </>
          ) : null}
        </div>
      )}
      <ol className="space-y-2.5">
        {shown.map((m, i) => (
          <HomeMatchItem key={m.area.area.id} m={m} i={i} src={src} active={activeId === m.area.area.id} onPick={onPick} actions={actions} />
        ))}
      </ol>
      {ms.length > FIRST && (
        <button onClick={() => setAll((v) => !v)} aria-expanded={all} className="mt-2 flex min-h-9 items-center gap-1 text-[13px] font-[600] text-ink-2 hover:text-ink">
          <ChevronDown size={15} className={`transition-transform ${all ? "rotate-180" : ""}`} />
          {all ? "Show the first three only" : `Show all ${ms.length} areas checked`}
        </button>
      )}
      {ms.length > 0 && <Definition className="mt-2" label="What the overlap number means" text={OVERLAP_EXPLAINER} />}
    </div>
  );
}

// ---------------------------------------------------------------- Check an address

const PRECISION: Record<AddressView["geocodeQuality"], { text: string; warn: boolean }> = {
  building: { text: "Matched the building", warn: false },
  street: { text: "Matched the street, not the house number", warn: true },
  area: { text: "Matched the area only, not a street", warn: true },
};

export function AddressCard({
  view,
  compact = false,
  selectedName,
  actions,
  onOpenPlace,
}: {
  view: AddressView;
  compact?: boolean;
  /** the area selected on the map, named when the address lies outside it */
  selectedName?: string | null;
  actions?: AreaActions;
  onOpenPlace?: (v: VenueEvidence) => void;
}) {
  const estimated = /\(street estimate\)/i.test(view.label);
  const label = view.label.replace(/\s*\(street estimate\)/i, "");
  const p = estimated ? { text: "House number not found: the street is placed from listed addresses on it", warn: true } : PRECISION[view.geocodeQuality];
  const a = view.area;
  const nearby = [...view.nearby].sort((x, y) => x.walkMinutes - y.walkMinutes);
  const roles = [...new Set(nearby.map((n) => n.venue.role))] as VenueRole[];
  const audit = view.constraintsAudit;
  const hoursUnknown = nearby.filter((n) => n.venue.hoursStatus === "unknown").length;
  const notes = [...new Set([...audit.hardViolations.map((h) => h.reason), ...audit.unmet.map((u) => u.reason), ...audit.warnings])].filter((n) => !/street estimate|house number could not/i.test(n) || !estimated);


  if (compact)
    return (
      <div data-testid="address-card" className="rounded-[18px] bg-paper-raised p-3.5 ring-1 ring-line">
        <p className="truncate text-[12.5px] font-[560] text-ink-3">{label}</p>
        <p className={`mt-1 text-[12.5px] font-[580] ${p.warn ? "text-[color-mix(in_oklch,var(--warn)_70%,var(--ink))]" : "text-ink-3"}`}>{p.text}</p>
        {a && (
          <p className="mt-1 flex items-baseline justify-between gap-2 text-[15px] font-[620]">
            <span className="truncate">{areaName(a.area)}</span>
            <AreaRank metrics={a.metrics} size="sm" note={false} />
          </p>
        )}
        <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
          {nearby.length ? `${nearby.length} checked ${nearby.length === 1 ? "place" : "places"} within a short walk${roles.length ? `: ${joinWords(roles.map((r) => ROLE_PLURAL[r]))}` : ""}.` : "No checked places within a short walk."}
        </p>
      </div>
    );

  return (
    <div>
      <section className="rounded-[20px] bg-[color-mix(in_oklch,var(--you)_5%,var(--paper-raised))] p-4 ring-1 ring-[color-mix(in_oklch,var(--you)_22%,transparent)]">
        <p className="text-[16px] font-[620] leading-snug tracking-[-0.01em] text-ink" data-testid="spot-label">
          {label}
        </p>
        <p
          data-testid="spot-precision"
          data-quality={view.geocodeQuality}
          className={`mt-1.5 inline-flex rounded-[8px] px-2 py-1 text-[12.5px] font-[600] leading-snug ${p.warn ? "bg-[color-mix(in_oklch,var(--warn)_16%,var(--paper-raised))] text-ink" : "bg-paper-sunk text-ink-2"}`}
        >
          {p.text}
        </p>
        {p.warn && (
          <p data-testid="spot-house-unchecked" className="mt-1.5 text-[13px] font-[560] leading-snug text-ink">
            The house itself was not checked. Everything below is about the streets around this point.
          </p>
        )}
        {a ? (
          <div className="mt-3.5">
            <p className="text-[12.5px] font-[560] text-ink-3">In the area</p>
            <p className="text-[20px] font-[660] leading-tight tracking-[-0.02em]">{areaName(a.area)}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-3">{areaScale(a.area)}</p>
            <AreaRank metrics={a.metrics} size="md" className="mt-2" />
          </div>
        ) : (
          <p className="mt-3 text-[13.5px] leading-snug text-ink-2">This point is outside the areas Homing compared, so it has no rank. The places nearby are still checked.</p>
        )}
        {view.outsideSelectedArea && (
          <p data-testid="spot-outside" className="mt-3 flex items-start gap-2 rounded-[12px] bg-paper-raised px-3 py-2 text-[13px] leading-snug text-ink-2 ring-1 ring-line">
            <CircleAlert size={15} className="mt-0.5 shrink-0 text-ink-3" />
            <span>
              This address is outside {selectedName ? <b className="font-[600] text-ink">{selectedName}</b> : "the area you selected"}. It is described where it actually is.
            </span>
          </p>
        )}
        <p className="mt-3 text-[12px] leading-snug text-ink-3">This describes the streets around the point, not the flat or the building.</p>
        {a && <ActionRow area={a} actions={actions} />}
      </section>

      <section className="mt-5">
        <h3 className="text-[15px] font-[620] tracking-[-0.01em]">Within a short walk</h3>
        <p className="mb-1.5 mt-0.5 text-[12px] leading-snug text-ink-3">
          Places that passed the checks for your taste. Walking times are straight-line estimates, not routes.
          {hoursUnknown > 0 ? ` ${hoursUnknown === nearby.length ? "None" : `${nearby.length - hoursUnknown} of ${nearby.length}`} ${hoursUnknown === nearby.length ? "has" : "have"} listed opening hours.` : ""}
        </p>
        {nearby.length ? (
          <ul className="-mx-2 space-y-0.5">
            {nearby.slice(0, 6).map((n) => (
              <li key={n.venue.venueKey}>
                <VenueRow v={n.venue} minutes={n.walkMinutes} onOpen={onOpenPlace ? () => onOpenPlace(n.venue) : undefined} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-ink-2">No place near this point passed the checks for your taste.</p>
        )}
      </section>

      {notes.length > 0 && (
        <section className="mt-4 rounded-[14px] bg-paper-sunk/80 px-3.5 py-2.5">
          <p className="text-[12.5px] font-[600] text-ink-2">Not confirmed</p>
          <ul className="mt-1 space-y-0.5 text-[12.5px] leading-snug text-ink-2">
            {notes.slice(0, 4).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Why this area

const OUT = 9;
function Slope({ from, to, delay = 0 }: { from: number; to: number | null; delay?: number }) {
  const W = 64;
  const H = 36;
  const y = (r: number) => 4 + ((Math.min(r, OUT) - 1) / (OUT - 1)) * (H - 8);
  const t = to ?? OUT;
  const color = to === null || t > from ? "var(--you)" : t < from ? "var(--them)" : "var(--ink-3)";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden>
      <line x1={6} x2={6} y1={3} y2={H - 3} stroke="var(--line)" strokeWidth={1} />
      <line x1={W - 6} x2={W - 6} y1={3} y2={H - 3} stroke="var(--line)" strokeWidth={1} />
      <motion.line
        x1={6}
        y1={y(from)}
        x2={W - 6}
        y2={y(t)}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={to === null ? "3 3" : undefined}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, delay, ease: [0.2, 0.8, 0.2, 1] }}
      />
      <circle cx={6} cy={y(from)} r={3} fill="var(--ink)" />
      <motion.circle cx={W - 6} cy={y(t)} r={3} fill={color} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...SPRING, delay: delay + 0.35 }} />
    </svg>
  );
}

/** "What changes the choice": the area's rank with each love taken away on its own, from the same computed matrix. */
export function AblationRows({ rows, compact }: { rows: AblationV2[]; compact?: boolean }) {
  const loveName = useLoveName();
  const sorted = [...rows].sort((a, b) => (b.withoutRank ?? 99) - (a.withoutRank ?? 99));
  return (
    <ul className={compact ? "space-y-1" : "space-y-1.5"}>
      {sorted.map((w, i) => {
        const l = loveName(w.loveId);
        const name = l?.name ?? "One of your loves";
        const m = moveText(w);
        const tone = m.tone === "drop" ? "text-you-deep" : m.tone === "rise" ? "text-[color-mix(in_oklch,var(--them)_80%,var(--ink))]" : "text-ink-3";
        return (
          <li key={`${w.areaId}-${w.loveId}`} aria-label={`Without ${name}: ${m.text.toLowerCase()}`} className={`flex items-center gap-2.5 rounded-[11px] ${compact ? "py-0.5" : "px-1.5 py-1"} ${m.tone === "drop" && !compact ? "bg-[color-mix(in_oklch,var(--you)_6%,transparent)]" : ""}`}>
            {l?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.image} alt="" width={24} height={24} className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-line" loading="lazy" />
            ) : (
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-paper-sunk text-[11px] font-[650] text-ink-2 ring-1 ring-line">{name.slice(0, 1)}</span>
            )}
            <span className={`min-w-0 flex-1 ${compact ? "text-[12.5px]" : "text-[13.5px]"}`}>
              <span className="block truncate font-[560]">
                <span className="font-[450] text-ink-3">Without </span>
                {name}
              </span>
              <span className={`tnum block text-[12px] font-[580] ${tone}`}>{m.text}</span>
            </span>
            <Slope from={w.baseRank} to={w.withoutRank} delay={0.15 + i * 0.05} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Why this area (§10.1): one real input → place link, the counterfactual or stability, and the everyday check.
 * Every line comes from the result; nothing is shown when the result has nothing to say.
 */
export function AreaProof({ area, ablations, compact = false, actions }: { area: AreaDecision; ablations?: AblationV2[]; compact?: boolean; actions?: AreaActions }) {
  const loveName = useLoveName();
  const linked = area.anchors.map((v) => ({ v, c: bestConnection(v, loveName) })).find((x) => x.c);
  const rows = (ablations ?? []).filter((a) => a.areaId === area.area.id);
  const cf = counterfactual(rows, loveName);
  const roles = [...new Set(area.anchors.filter((v) => v.eligibility === "eligible").map((v) => v.role))];
  const unknownHours = area.anchors.filter((v) => v.hoursStatus === "unknown").length;
  const unknownPrice = area.anchors.filter((v) => v.priceStatus === "unknown").length;
  const eligible = area.anchors.filter((v) => v.eligibility === "eligible").length;
  const line = "flex items-start gap-2.5 text-[13.5px] leading-snug text-ink";
  const dot = "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full";
  return (
    <section data-testid="area-proof" aria-label={`Why ${area.area.name}`} className={compact ? "" : "space-y-2.5"}>
      {!compact && area.headline && <p className="text-[15px] font-[560] leading-snug text-ink">{area.headline}</p>}
      <ul className={compact ? "space-y-1.5" : "space-y-2.5"}>
        {linked && linked.c && (
          <li className={line} data-testid="proof-link">
            <span className={dot} style={{ background: loveName(linked.c.loveId)?.ink ?? "var(--you)" }} />
            <span>
              <b className="font-[620]">{loveName(linked.c.loveId)!.name}</b> helped surface <b className="font-[620]">{linked.v.place.name}</b>
              <span className="block text-[12.5px] text-ink-3">
                {connectionLine(linked.c, loveName(linked.c.loveId)!.name)}.{/%/.test(connectionLine(linked.c, "")) ? " A share of Qloo's explanation, not of people." : ""}
              </span>
            </span>
          </li>
        )}
        {cf && (
          <li className={line} data-testid="proof-counterfactual" data-moved={cf.moved}>
            {cf.moved ? <span className={`${dot} bg-you`} /> : <Check size={15} className="mt-0.5 shrink-0 text-ok" />}
            <span>{cf.text}</span>
          </li>
        )}
        <li className={line} data-testid="proof-everyday">
          <span className={`${dot} ${eligible >= 3 ? "bg-ok" : "bg-ink-3"}`} />
          <span>
            {eligible > 0 ? (
              <>
                {eligible} checked {eligible === 1 ? "place" : "places"} for {joinWords(roles.map((r) => ROLE_PLURAL[r]))}
              </>
            ) : (
              "No everyday places confirmed here yet"
            )}
            {area.recommendationStatus === "needs_checking" && <span className="block text-[12.5px] text-ink-3">Promising, needs checking on the ground.</span>}
            {(unknownHours > 0 || unknownPrice > 0) && !compact && (
              <span className="block text-[12.5px] text-ink-3">
                {[unknownHours ? `${unknownHours} without listed hours` : "", unknownPrice ? `${unknownPrice} without a listed price` : ""].filter(Boolean).join(", ")}.
              </span>
            )}
          </span>
        </li>
      </ul>
      {!compact && area.tradeoff && (
        <p className="rounded-[12px] bg-paper-sunk/80 px-3 py-2 text-[13px] leading-snug text-ink-2">
          <span className="font-[600] text-ink">Keep in mind: </span>
          {area.tradeoff}
        </p>
      )}
      {!compact && <ActionRow area={area} actions={actions} />}
    </section>
  );
}

/** The assistant's explanation card: its checked claims and the ablation rows. */
export function ExplanationCard({ view, areaName: name, compact = false }: { view: ExplainView; areaName?: string; compact?: boolean }) {
  const loveName = useLoveName();
  const byArea = new Map<string, AblationV2[]>();
  for (const a of view.ablations) byArea.set(a.areaId, [...(byArea.get(a.areaId) ?? []), a]);
  const first = view.baseOrder?.find((id) => byArea.has(id)) ?? [...byArea.keys()][0];
  const rows = first ? byArea.get(first)! : [];
  const cf = counterfactual(rows, loveName);
  return (
    <div data-testid="explanation-card" className={compact ? "rounded-[18px] bg-paper-raised p-3.5 ring-1 ring-line" : ""}>
      {view.claims.length > 0 && (
        <div className="space-y-1">
          {view.claims.slice(0, compact ? 2 : 4).map((c: Claim) => (
            <p key={c.text} className={compact ? "text-[13.5px] leading-snug text-ink" : "text-[15px] leading-snug text-ink"}>
              {c.text}
            </p>
          ))}
        </div>
      )}
      {cf && (
        <p className={`mt-2 flex items-start gap-2 rounded-[12px] px-3 py-2 leading-snug ${compact ? "text-[12.5px]" : "text-[13.5px]"} ${cf.moved ? "bg-you-soft/70" : "bg-[color-mix(in_oklch,var(--ok)_10%,var(--paper-raised))]"} text-ink`}>
          {cf.moved ? <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-you" /> : <Check size={15} className="mt-0.5 shrink-0 text-ok" />}
          {name ? <span>{name}: {cf.text.charAt(0).toLowerCase() + cf.text.slice(1)}</span> : cf.text}
        </p>
      )}
      {rows.length > 0 && (
        <div className="mt-2.5">
          <AblationRows rows={rows} compact={compact} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Comparison of cities

type CityResult = ComparisonView["results"][number];

function CityResultCard({ r, i, onOpenCity, sourceName, compact }: { r: CityResult; i: number; onOpenCity?: (city: string) => void; sourceName?: string | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (r.status === "error")
    return (
      <li data-testid="city-error" className="rounded-[18px] bg-paper-raised p-3.5 ring-1 ring-line">
        <p className="text-[16px] font-[640] tracking-[-0.015em] text-ink-2">{r.cityName}</p>
        <p className="mt-1 text-[13px] leading-snug text-ink-2">{r.error?.message ?? "Homing could not check this city."}</p>
      </li>
    );
  const home = r.homeMatches ?? [];
  const overlap = r.culturalOverlap;
  const method = home[0]?.similarity.method;
  const areas = home.length ? home.slice(0, 3).map((m) => ({ id: m.area.area.id, name: areaName(m.area.area), sim: m.similarity })) : r.areas.slice(0, 3).map((a) => ({ id: a.area.id, name: areaName(a.area), sim: null }));
  const anchors = (home[0]?.area.anchors.length ? home[0].area.anchors : r.areas[0]?.anchors ?? []).slice(0, 2);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: i * 0.06 }}
      data-testid="city-result"
      data-status={r.status}
      className="rounded-[18px] bg-paper-raised p-3.5 ring-1 ring-line"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[19px] font-[650] tracking-[-0.02em]">{r.cityName}</p>
          {overlap !== null && r.support === "sufficient" ? (
            <p className="tnum mt-0.5 text-[13px] font-[580] text-ink-2">
              {sourceName ? (method?.startsWith("style_only") ? "Style overlap" : "Cultural-profile overlap") : "Overlap with your taste"} {Math.round(overlap)}/100
            </p>
          ) : (
            <p className="mt-0.5 text-[13px] text-ink-3">No comparable number for this city</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <SupportTag quality={r.support} />
          {r.status === "partial" && <span className="text-[12px] font-[560] text-ink-3">Partly checked</span>}
        </div>
      </div>
      {areas.length > 0 && (
        <ol className="mt-2.5 space-y-1">
          {areas.map((a, k) => (
            <li key={a.id} className="flex items-baseline justify-between gap-2 text-[13.5px]">
              <span className="min-w-0 truncate">
                <span className="tnum mr-1.5 text-[12.5px] font-[620] text-ink-3">{k + 1}</span>
                <span className={k === 0 ? "font-[620] text-ink" : "text-ink-2"}>{a.name}</span>
              </span>
              {a.sim && overlapText(a.sim) && <span className="tnum shrink-0 text-[12.5px] text-ink-3">{Math.round(a.sim.value!)}/100</span>}
            </li>
          ))}
        </ol>
      )}
      {!compact && r.eligibleCategories.length > 0 && <p className="mt-2 text-[12.5px] text-ink-3">Checked places for {joinWords(r.eligibleCategories.map((c) => c.replace(/_/g, " ")))}.</p>}
      {!compact && anchors.length > 0 && (
        <>
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-2 flex min-h-8 items-center gap-1 text-[12.5px] font-[580] text-ink-2 hover:text-ink">
            <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} /> Places in {areas[0]?.name}
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="-mx-2 overflow-hidden">
                {anchors.map((v) => (
                  <VenueRow key={v.venueKey} v={v} compact />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
      {onOpenCity && (
        <button onClick={() => onOpenCity(r.cityName)} className="mt-2.5 flex min-h-8 items-center gap-1 text-[13px] font-[600] text-you-deep hover:underline">
          Open the map of {r.cityName} <ArrowRight size={14} />
        </button>
      )}
    </motion.li>
  );
}

/**
 * Two or three cities checked with one method. Each city keeps its own status; an invalid city is its own card.
 * The recommendation is the backend's (null when the difference is in the tie zone or the data is thin).
 */
export function ComparisonCard({ view, compact = false, onOpenCity, sourceName }: { view: ComparisonView; compact?: boolean; onOpenCity?: (city: string) => void; sourceName?: string | null }) {
  const ok = view.results.filter((r) => r.status !== "error");
  const rec = view.recommendation;
  const recName = rec ? view.results.find((r) => r.cityId === rec.cityId)?.cityName : null;
  return (
    <div data-testid="comparison-card" className={compact ? "rounded-[18px] bg-paper-raised p-3.5 ring-1 ring-line" : ""}>
      {ok.length >= 2 && (
        <p data-testid="comparison-verdict" className={compact ? "text-[13.5px] leading-snug text-ink" : "mb-3 text-[15px] leading-snug text-ink"}>
          {rec && recName ? (
            <>
              <b className="font-[650]">Start with {recName}.</b> {rec.claims.map((c) => c.text).join(" ")}
            </>
          ) : (
            "No clear winner on this data. Compare the areas and places of each city below."
          )}
        </p>
      )}
      <ol className={`grid gap-2.5 ${compact ? "mt-2" : "min-[1100px]:grid-cols-2"}`}>
        {view.results.map((r, i) => (
          <CityResultCard key={r.cityId + i} r={r} i={i} onOpenCity={onOpenCity} sourceName={sourceName} compact={compact} />
        ))}
      </ol>
    </div>
  );
}

