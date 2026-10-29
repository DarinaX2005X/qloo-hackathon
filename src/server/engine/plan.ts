import { type Category, type ExploreState, type Itinerary, type Place, apiError } from "@/shared/contracts";
import { walkMinutes } from "./geo";
import { rankNeighborhoods } from "./neighborhoods";
import { buildFingerprint } from "./fingerprint";
import { placesNear, WEEKDAYS } from "./places";

export const PLAN_SLOTS: { time: string; slot: string; categories: Category[] }[] = [
  { time: "09:00", slot: "Morning coffee", categories: ["coffee"] },
  { time: "11:00", slot: "Morning culture", categories: ["culture"] },
  { time: "13:30", slot: "Lunch", categories: ["food"] },
  { time: "16:00", slot: "Afternoon discovery", categories: ["culture", "coffee"] },
  { time: "19:30", slot: "Dinner", categories: ["food"] },
  { time: "21:30", slot: "Evening drinks", categories: ["drinks"] },
];

export function minutes(time: string): number {
  const match = /^(?:T)?([0-2]\d):([0-5]\d)(?::[0-5]\d)?$/.exec(time);
  if (!match || +match[1] > 24 || (+match[1] === 24 && +match[2] > 0)) return NaN;
  return +match[1] * 60 + +match[2];
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

export type PlanArea = { id: string; name: string; places: Place[] };

export function planFromPlaces(days: 1 | 2 | 3, areas: PlanArea[], now: Date = new Date()): Itinerary {
  if (!areas.length) throw apiError("bad_input", "Select at least one neighborhood.");
  const used = new Set<string>();
  const itinerary: Itinerary = { days: [] };
  for (let day = 0; day < days; day++) {
    const area = areas[Math.min(day, areas.length - 1)];
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day + 1));
    const result: Itinerary["days"][number] = { date: date.toISOString().slice(0, 10), weekday: WEEKDAYS[date.getUTCDay()], neighborhood: area.name, stops: [], missing: [] };
    let previous: Place | undefined;
    for (const slot of PLAN_SLOTS) {
      const candidates = area.places.filter((place) => slot.categories.includes(place.category) && !used.has(place.id) && isOpen(place, date, slot.time) !== false)
        .map((place) => ({ place, walk: previous ? walkMinutes([previous.lon, previous.lat], [place.lon, place.lat]) : 0 }))
        .sort((a, b) => (b.place.affinity - 0.04 * b.walk) - (a.place.affinity - 0.04 * a.walk) || a.place.id.localeCompare(b.place.id));
      const best = candidates[0];
      if (!best) { result.missing.push(slot.slot); continue; }
      result.stops.push({ time: slot.time, slot: slot.slot, place: best.place, walkMin: Math.round(best.walk),
        hoursNote: isOpen(best.place, date, slot.time) === true ? "open" : "hours not listed" });
      used.add(best.place.id);
      previous = best.place;
    }
    itinerary.days.push(result);
  }
  return itinerary;
}

export async function solvePlan(state: ExploreState, neighborhoodIds: string[]): Promise<Itinerary> {
  if (!neighborhoodIds.length || neighborhoodIds.length > 3) throw apiError("bad_input", "Select one to three neighborhoods.");
  const [neighborhoods, fingerprint] = await Promise.all([rankNeighborhoods(state), buildFingerprint(state)]);
  const selected = neighborhoodIds.map((id) => {
    const neighborhood = neighborhoods.find((item) => item.id === id);
    if (!neighborhood) throw apiError("not_found", "Neighborhood not found in this taste map.");
    return neighborhood;
  });
  const areas = await Promise.all(selected.slice(0, state.days).map(async (neighborhood) => ({
    id: neighborhood.id, name: neighborhood.name,
    places: await placesNear(state, neighborhood, ["coffee", "culture", "food", "drinks"], [...fingerprint.you, ...(fingerprint.them ?? [])]),
  })));
  return planFromPlaces(state.days, areas);
}
