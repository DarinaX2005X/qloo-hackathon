"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, Footprints, Route, Shuffle, Trash2 } from "lucide-react";
import type { VisitResultV2 } from "./types";
import { ConstraintChips } from "./Constraints";
import { VenueRow } from "./Venues";
import { Spinner } from "@/components/ui/primitives";
import { constraintLabel, dayNoteLines, RECOVERY_TEXT, sentence, unmetText } from "@/lib/explain";
import { walkText } from "@/lib/honest";

type Stop = VisitResultV2["itinerary"]["days"][number]["stops"][number];

export const visitStops = (r: VisitResultV2): Stop[] => r.itinerary.days.flatMap((d) => d.stops);
export const visitAreaNames = (r: VisitResultV2) => [...new Set(r.itinerary.days.map((d) => d.neighborhood).filter(Boolean))];
const placeNames = (r: VisitResultV2) => Object.fromEntries(visitStops(r).map((s) => [s.place.id, s.place.name]));

/** Backend reasons can carry a raw place ID; a person sees the place's name, or "a place". */
const ID_RE = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi;
const noIds = (text: string, names: Record<string, string>) => text.replace(ID_RE, (id) => names[id] ?? names[id.toUpperCase()] ?? "a place").replace(/Requested place a place/g, "A requested place");

/** Rules broken (should never show), goals not met, and what is unknown: before the stops, never hidden. */
export function VisitAudit({ result }: { result: VisitResultV2 }) {
  const { hardViolations, unmet, warnings } = result.audit;
  const names = placeNames(result);
  const ruleOf = (id: string) => result.constraints.find((c) => c.id === id);
  if (!hardViolations.length && !unmet.length && !warnings.length) return null;
  return (
    <div className="space-y-1.5" data-testid="visit-audit">
      {hardViolations.length > 0 && (
        <div role="alert" className="flex gap-2 rounded-[12px] bg-[color-mix(in_oklch,var(--err)_10%,var(--paper-raised))] px-3 py-2 text-[13px] leading-snug text-[var(--err)]">
          <AlertTriangle size={15} className="mt-[1px] shrink-0" />
          <div>
            <p className="font-[620]">This walk breaks a rule you set. Don&apos;t rely on it; plan again.</p>
            <ul className="mt-0.5">
              {hardViolations.map((v, i) => (
                <li key={i}>
                  {v.placeId && names[v.placeId] ? `${names[v.placeId]}: ` : ""}
                  {noIds(v.reason, names)}
                  {ruleOf(v.constraintId) ? ` (${constraintLabel(ruleOf(v.constraintId)!, names)})` : ""}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {unmet.length > 0 && (
        <div className="rounded-[12px] bg-paper-sunk/80 px-3 py-2 text-[13px] leading-snug text-ink-2" data-testid="visit-unmet">
          <p className="font-[600] text-ink">Not everything you asked for is in this walk</p>
          <ul className="mt-0.5 list-disc pl-4">
            {[...new Set(unmet.map((u) => sentence(noIds(unmetText(u.reason), names))))].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-0.5 px-1 text-[12.5px] leading-snug text-ink-3">
          {[...new Set(warnings.map((w) => sentence(noIds(unmetText(w), names))))].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the planner changed to make the walk work, and which stops it touched. */
export function RecoveryLog({ result }: { result: VisitResultV2 }) {
  if (!result.recoveryLog.length) return null;
  const names = placeNames(result);
  return (
    <div className="rounded-[12px] border-l-[3px] border-[var(--them)] bg-[color-mix(in_oklch,var(--them)_7%,var(--paper-raised))] px-3 py-2" data-testid="visit-recovery">
      <p className="text-[12.5px] font-[620] text-ink">What changed to make it work</p>
      <ul className="mt-0.5 space-y-0.5 text-[13px] leading-snug text-ink-2">
        {result.recoveryLog.map((r, i) => {
          const touched = r.changedStopIds.map((id) => names[id]).filter(Boolean);
          return (
            <li key={i}>
              {RECOVERY_TEXT[r.action]}
              {touched.length ? ` (${touched.join(", ")})` : ""}: {lower(sentence(noIds(unmetText(r.reason), names)))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The stops with what each place is, what is not known about it, and Swap / Remove that keep the rest. */
export function VisitStops({
  result,
  onSwap,
  onRemove,
  busy,
  swapping,
  onHover,
  limit,
}: {
  result: VisitResultV2;
  onSwap?: (placeId: string) => void;
  onRemove?: (placeId: string) => void;
  busy?: boolean;
  swapping?: string | null;
  onHover?: (placeId: string | null) => void;
  limit?: number;
}) {
  const days = result.itinerary.days;
  const multi = days.length > 1;
  return (
    <div className="space-y-3">
      {days.map((d, di) => {
        // a gap the audit already lists above is not repeated under the day
        const told = result.audit.unmet.map((u) => unmetText(u.reason).replace(/[.\s]+$/, "").toLowerCase());
        const notes = dayNoteLines(d, d.neighborhood).filter((l) => !told.some((t) => t && l.toLowerCase().includes(t)));
        const stops = limit ? d.stops.slice(0, limit) : d.stops;
        return (
          <section key={di}>
            {multi && <p className="mb-1.5 text-[13px] font-[620] text-ink">Day {di + 1}, {d.neighborhood}</p>}
            <ol className="relative ml-[9px] border-l-2 border-dashed border-[var(--line-strong)] pl-4">
              <AnimatePresence initial={false}>
                {stops.map((s) => {
                  const v = result.venueEvidence[s.place.id];
                  return (
                    <motion.li
                      key={s.place.id}
                      layout
                      data-testid="visit-stop"
                      data-place-id={s.place.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 6 }}
                      transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
                      className="relative pb-3.5 last:pb-0"
                      onMouseEnter={() => onHover?.(s.place.id)}
                      onMouseLeave={() => onHover?.(null)}
                    >
                      <span className="absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full bg-paper-raised ring-2 ring-ink" />
                      {s.walkMin > 0 && (
                        <span className="mb-0.5 flex items-center gap-1 text-[11.5px] text-ink-3" title="Straight-line distance, not a route">
                          <Footprints size={12} /> {walkText(s.walkMin, s.walkIsApproximate ?? true)}
                        </span>
                      )}
                      <div className="flex gap-2.5">
                        <span className="tnum w-11 shrink-0 pt-[15px] text-[14px] font-[620] text-ink">{s.time}</span>
                        <div className="min-w-0 flex-1">
                          {v ? (
                            <VenueRow
                              v={v}
                              meta={<p className="text-[12.5px] text-ink-3">{s.slot}</p>}
                              actions={<StopActions name={s.place.name} id={s.place.id} onSwap={onSwap} onRemove={onRemove} busy={busy} swapping={swapping} />}
                            />
                          ) : (
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-[11.5px] font-[600] uppercase tracking-[0.04em] text-ink-3">{s.slot}</p>
                                <p className="line-clamp-2 text-[15px] font-[600] leading-snug text-ink">{s.place.name}</p>
                                {s.hoursNote === "hours not listed" && <p className="text-[12px] text-ink-3">Hours not listed</p>}
                              </div>
                              <StopActions name={s.place.name} id={s.place.id} onSwap={onSwap} onRemove={onRemove} busy={busy} swapping={swapping} />
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ol>
            {limit && d.stops.length > limit && <p className="mt-1 pl-[60px] text-[12px] text-ink-3">and {d.stops.length - limit} more</p>}
            {notes.length > 0 && (
              <ul className="mt-2 space-y-0.5 rounded-[10px] bg-paper-sunk/70 px-2.5 py-1.5 text-[12.5px] leading-snug text-ink-2">
                {notes.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function StopActions({
  id,
  name,
  onSwap,
  onRemove,
  busy,
  swapping,
}: {
  id: string;
  name: string;
  onSwap?: (id: string) => void;
  onRemove?: (id: string) => void;
  busy?: boolean;
  swapping?: string | null;
}) {
  if (!onSwap && !onRemove) return null;
  return (
    <span className="flex items-center">
      {onSwap && (
        <button
          onClick={() => onSwap(id)}
          disabled={busy}
          aria-label={`Swap ${name} for another place and keep the other stops`}
          title="Swap for another place, keep the rest"
          className="flex h-8 items-center gap-1 rounded-[8px] px-2 text-[12.5px] font-[580] text-ink-2 hover:bg-paper-sunk hover:text-ink disabled:opacity-40"
        >
          {swapping === id ? <Spinner size={12} /> : <Shuffle size={13} />} Swap
        </button>
      )}
      {onRemove && (
        <button
          onClick={() => onRemove(id)}
          disabled={busy}
          aria-label={`Remove ${name} from the walk and never suggest it again`}
          title="Remove, and don't suggest it again"
          className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-sunk hover:text-ink disabled:opacity-40"
        >
          <Trash2 size={13} />
        </button>
      )}
    </span>
  );
}

/** The walk the assistant planned, in the conversation, with a way to open it on the Try screen. */
export function VisitCard({ result, onOpen, stale, showRules = true }: { result: VisitResultV2; onOpen?: () => void; stale?: boolean; showRules?: boolean }) {
  const stops = visitStops(result);
  const areas = visitAreaNames(result);
  const names = placeNames(result);
  return (
    <div data-testid="visit-card">
      <div className={`rounded-[18px] bg-paper-raised p-3.5 ring-1 ring-line ${stale ? "opacity-70" : ""}`}>
        <p className="flex items-center gap-1.5 text-[12.5px] font-[560] text-ink-3">
          <Route size={13} /> A walk to try {areas.length ? areas.join(" and ") : "the area"}, {stops.length} {stops.length === 1 ? "stop" : "stops"}
        </p>
        <div className="mt-2.5 space-y-2.5">
          {showRules && <ConstraintChips constraints={result.constraints} names={names} label={null} testId="visit-card-rules" />}
          <VisitAudit result={result} />
          <RecoveryLog result={result} />
          <VisitStops result={result} limit={4} />
        </div>
        <p className="mt-2.5 text-[11.5px] text-ink-3">Times include approximate walking between stops.</p>
      </div>
      {onOpen && (
        <button onClick={onOpen} className="mt-1.5 flex items-center gap-1.5 rounded-[9px] px-2 py-1 text-[13px] font-[600] text-you-deep transition-colors hover:bg-you-soft/60">
          <Route size={14} /> Open the walk <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}

const lower = (s: string) => (s && !/^[A-Z]{2}/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
