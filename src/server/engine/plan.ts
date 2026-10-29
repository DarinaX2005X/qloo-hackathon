import { type Category, type ExploreState, type Itinerary, type Place, apiError } from "@/shared/contracts";
import { walkMinutes } from "./geo";
import { rankNeighborhoods } from "./neighborhoods";
import { getCityEvidence } from "./evidence";
import { placesNear, WEEKDAYS, withinBudget } from "./places";

export type PlanSlot = { time: string; slot: string; categories: Category[] };
export const PLAN_SLOTS: PlanSlot[] = [
  { time: "09:00", slot: "Morning coffee", categories: ["coffee"] },
  { time: "11:00", slot: "Morning culture", categories: ["culture"] },
  { time: "13:30", slot: "Lunch", categories: ["food"] },
  { time: "16:00", slot: "Afternoon discovery", categories: ["culture", "coffee"] },
  { time: "19:30", slot: "Dinner", categories: ["food"] },
  { time: "21:30", slot: "Evening drinks", categories: ["drinks"] },
];
export type PlanOptions = Partial<Pick<ExploreState, "pace" | "startHour" | "budget">> & { exclude?: string[]; include?: string[] };
export type PlanArea = { id: string; name: string; places: Place[] };
export type ScheduledSlot = PlanSlot & { day: number; date: Date; area: PlanArea; place?: Place };

export function minutes(time: string): number {
  const match = /^(?:T)?([0-2]\d):([0-5]\d)(?::[0-5]\d)?$/.exec(time);
  if (!match || +match[1] > 24 || (+match[1] === 24 && +match[2] > 0)) return NaN;
  return +match[1] * 60 + +match[2];
}

export function timeLabel(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

type Step = { kind: "coffee" | "culture" | "lunch" | "discovery"; stay: number };
const DAYTIME: Record<NonNullable<ExploreState["pace"]>, Step[]> = {
  relaxed: [{ kind: "coffee", stay: 90 }, { kind: "culture", stay: 150 }],
  balanced: [{ kind: "coffee", stay: 90 }, { kind: "culture", stay: 150 }, { kind: "lunch", stay: 120 }, { kind: "discovery", stay: 120 }],
  packed: [
    { kind: "coffee", stay: 60 }, { kind: "culture", stay: 120 }, { kind: "lunch", stay: 90 },
    { kind: "culture", stay: 90 }, { kind: "coffee", stay: 60 }, { kind: "discovery", stay: 90 },
  ],
};

/** Name a stop by when it actually happens, so an 11:00 start never shows "Morning culture" at 13:00. */
function slotName(kind: Step["kind"], at: number): string {
  if (kind === "lunch") return "Lunch";
  if (kind === "coffee") return at < 11 * 60 + 30 ? "Morning coffee" : "Coffee break";
  if (kind === "discovery") return at < 17 * 60 ? "Afternoon discovery" : "Early evening discovery";
  return at < 12 * 60 ? "Morning culture" : at < 15 * 60 ? "Afternoon culture" : at < 17 * 60 ? "Late afternoon culture" : "Early evening culture";
}

/**
 * The day as a chain from the chosen start hour: daytime stops follow each other with realistic stays,
 * lunch is never before 12:30, dinner is never before 19:00, drinks follow dinner and end the day by 23:30.
 * A late start drops daytime stops that would run into dinner rather than squeezing them.
 */
export function planSlots(pace: ExploreState["pace"] = "balanced", startHour = 9): PlanSlot[] {
  const slots: PlanSlot[] = [];
  let at = startHour * 60;
  const dinner = Math.max(19 * 60, Math.min(20 * 60 + 30, at + (pace === "relaxed" ? 6 : 9) * 60));
  for (const step of DAYTIME[pace ?? "balanced"]) {
    if (step.kind === "lunch") at = Math.max(at, 12 * 60 + 30);
    if (at + 45 > dinner) break;
    const categories: Category[] = step.kind === "lunch" ? ["food"] : step.kind === "discovery" ? ["culture", "coffee"] : [step.kind];
    slots.push({ time: timeLabel(at), slot: slotName(step.kind, at), categories });
    at += step.stay;
  }
  slots.push({ time: timeLabel(dinner), slot: "Dinner", categories: ["food"] });
  slots.push({ time: timeLabel(Math.min(23 * 60 + 30, dinner + 120)), slot: "Evening drinks", categories: ["drinks"] });
  return slots;
}

/** Undefined means that this weekday has no usable hours information. */
export function isOpen(place: Place, date: Date, time: string): boolean | undefined {
  const at = minutes(time);
  const weekday = date.getUTCDay();
  const spans = place.hours?.[WEEKDAYS[weekday]];
  const previous = place.hours?.[WEEKDAYS[(weekday + 6) % 7]] ?? [];
  if (previous.some((span) => minutes(span.closes) < minutes(span.opens) && at < minutes(span.closes))) return true;
  if (spans === undefined) return undefined;
  let usable = !spans.length;
  for (const span of spans) {
    const opens = minutes(span.opens);
    const closes = minutes(span.closes);
    if (!Number.isFinite(opens) || !Number.isFinite(closes)) continue;
    usable = true;
    if (opens === closes || (closes < opens ? at >= opens : at >= opens && at < closes)) return true;
  }
  return usable ? false : undefined;
}

export function slotCandidates(slot: ScheduledSlot, used: Set<string>, options: PlanOptions, previous?: Place): Place[] {
  return slot.area.places.filter((place) => slot.categories.includes(place.category) && !used.has(place.id) &&
    !options.exclude?.includes(place.id) && withinBudget(place, options.budget) && isOpen(place, slot.date, slot.time) !== false)
    .map((place) => ({ place, walk: previous ? walkMinutes([previous.lon, previous.lat], [place.lon, place.lat]) : 0 }))
    .sort((a, b) => (a.place.affinity === b.place.affinity ? Number(a.place.priceLevel === undefined) - Number(b.place.priceLevel === undefined) : 0) ||
      (b.place.affinity - 0.04 * b.walk) - (a.place.affinity - 0.04 * a.walk) || a.place.id.localeCompare(b.place.id)).map((item) => item.place);
}

export function planFromPlaces(days: 1 | 2 | 3, areas: PlanArea[], now: Date = new Date(), options: PlanOptions = {}): Itinerary {
  if (!areas.length) throw apiError("bad_input", "Select at least one neighborhood.");
  const slots: ScheduledSlot[] = Array.from({ length: days }, (_, day) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day + 1));
    return planSlots(options.pace, options.startHour).map((slot) => ({ ...slot, day, date, area: areas[Math.min(day, areas.length - 1)] }));
  }).flat();
  const used = new Set<string>();
  const missingIncludes: string[] = [];
  // Reserve requested places before ordinary choices, starting with the earliest compatible day/slot.
  for (const id of [...new Set(options.include ?? [])]) {
    const place = areas.flatMap((area) => area.places).find((item) => item.id === id);
    let reason: string | undefined;
    if (!place) reason = "not available in the selected neighborhoods";
    else if (!withinBudget(place, options.budget)) reason = "above your budget";
    else {
      const compatible = slots.filter((slot) => slot.categories.includes(place.category) && slot.area.places.some((item) => item.id === id));
      const open = compatible.filter((slot) => isOpen(place, slot.date, slot.time) !== false);
      const target = open.find((slot) => !slot.place);
      if (target) { target.place = place; used.add(id); }
      else reason = compatible.length && !open.length ? "closed at the available times" : `no available ${place.category} slot`;
    }
    if (options.exclude?.includes(id)) reason = "excluded from this plan";
    if (reason) missingIncludes.push(`Couldn't fit ${place?.name ?? id}: ${reason}`);
  }
  // Reconstruct the same baseline independently of exclude, then reserve all surviving stops.
  let previous: Place | undefined;
  let previousDay = -1;
  for (const slot of slots) {
    if (slot.day !== previousDay) previous = undefined;
    if (!slot.place) {
      slot.place = slotCandidates(slot, used, { ...options, exclude: [] }, previous)[0];
      if (slot.place) used.add(slot.place.id);
    }
    if (slot.place) previous = slot.place;
    previousDay = slot.day;
  }
  const reserved = new Set(slots.flatMap((slot) => slot.place && !options.exclude?.includes(slot.place.id) ? [slot.place.id] : []));
  previous = undefined;
  previousDay = -1;
  for (const slot of slots) {
    if (slot.day !== previousDay) previous = undefined;
    if (slot.place && options.exclude?.includes(slot.place.id)) {
      slot.place = slotCandidates(slot, reserved, options, previous)[0];
      if (slot.place) reserved.add(slot.place.id);
    }
    if (slot.place) previous = slot.place;
    previousDay = slot.day;
  }
  return { days: Array.from({ length: days }, (_, day) => {
    const today = slots.filter((slot) => slot.day === day);
    const date = today[0].date;
    const result: Itinerary["days"][number] = { date: date.toISOString().slice(0, 10), weekday: WEEKDAYS[date.getUTCDay()], neighborhood: today[0].area.name, stops: [], missing: [] };
    let previous: Place | undefined;
    for (const slot of today) {
      if (!slot.place) { result.missing.push(slot.slot); continue; }
      const place = slot.place;
      result.stops.push({ time: slot.time, slot: slot.slot, place,
        walkMin: previous ? Math.round(walkMinutes([previous.lon, previous.lat], [place.lon, place.lat])) : 0,
        hoursNote: isOpen(place, date, slot.time) === true ? "open" : "hours not listed" });
      previous = place;
    }
    if (day === days - 1) result.missing.push(...missingIncludes);
    return result;
  }) };
}

export async function solvePlan(state: ExploreState, neighborhoodIds: string[], options: Pick<PlanOptions, "exclude" | "include"> = {}): Promise<Itinerary> {
  if (!neighborhoodIds.length || neighborhoodIds.length > 3) throw apiError("bad_input", "Select one to three neighborhoods.");
  const [neighborhoods, evidence] = await Promise.all([rankNeighborhoods(state), getCityEvidence(state)]);
  const selected = neighborhoodIds.map((id) => {
    const neighborhood = neighborhoods.find((item) => item.id === id);
    if (!neighborhood) throw apiError("not_found", "Neighborhood not found in this taste map.");
    return neighborhood;
  });
  const areas = await Promise.all(selected.slice(0, state.days).map(async (neighborhood) => ({
    id: neighborhood.id, name: neighborhood.name,
    places: await placesNear({ ...state, budget: null }, neighborhood, ["coffee", "culture", "food", "drinks", ...(options.include?.length ? ["stay" as const] : [])],
      [...evidence.fingerprint.you, ...(evidence.fingerprint.them ?? [])]),
  })));
  return planFromPlaces(state.days, areas, new Date(), { ...options, budget: state.budget, pace: state.pace, startHour: state.startHour });
}
