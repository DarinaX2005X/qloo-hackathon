import { type Category, type ExploreState, type Itinerary, type Place, apiError } from "@/shared/contracts";
import { walkMinutes } from "./geo";
import { haversine, coordinates } from "./geo";
import type { Neighborhood } from "@/shared/contracts";
import { rankNeighborhoods } from "./neighborhoods";
import { getCityEvidence } from "./evidence";
import { placesNear, WEEKDAYS, withinBudget, placeFromRow, bestCategory, CATEGORY_TAGS } from "./places";
import { qlooGet, resultRows, string } from "@/server/qloo/client";
import { remainingQlooCalls, withQlooBudget } from "@/server/qloo/budget";
import { QLOO_REQUEST_LIMITS } from "./rate-limit";

export const PLAN_QLOO_CALL_LIMIT = QLOO_REQUEST_LIMITS["/api/plan"];
export const MAX_RECOVERY_ATTEMPTS = 4;
export const MAX_RECOVERY_QLOO_CALLS = 44;

export type PlanSlot = { time: string; slot: string; categories: Category[] };
export const PLAN_SLOTS: PlanSlot[] = [
  { time: "09:00", slot: "Morning coffee", categories: ["coffee"] },
  { time: "11:00", slot: "Morning culture", categories: ["culture"] },
  { time: "13:30", slot: "Lunch", categories: ["food"] },
  { time: "16:00", slot: "Afternoon discovery", categories: ["culture", "coffee"] },
  { time: "19:30", slot: "Dinner", categories: ["food"] },
  { time: "21:30", slot: "Evening drinks", categories: ["drinks"] },
];
export type PlanOptions = Partial<Pick<ExploreState, "pace" | "startHour" | "budget">> & {
  exclude?: string[]; include?: string[]; excludeCategories?: Category[]; excludeTags?: string[];
  relaxCategories?: boolean;
};
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
    !excludedPlace(place, options) && withinBudget(place, options.budget) && suitableAt(place, slot.date, slot.time))
    .map((place) => ({ place, walk: previous ? walkMinutes([previous.lon, previous.lat], [place.lon, place.lat]) : 0 }))
    .sort((a, b) => (a.place.affinity === b.place.affinity ? Number(a.place.priceLevel === undefined) - Number(b.place.priceLevel === undefined) : 0) ||
      (b.place.affinity - 0.04 * b.walk) - (a.place.affinity - 0.04 * a.walk) || a.place.id.localeCompare(b.place.id)).map((item) => item.place);
}

/** Unknown hours at an event venue are not evidence of a daytime cultural visit. */
export function suitableAt(place: Place, date: Date, time: string): boolean {
  const open = isOpen(place, date, time);
  if (open === false) return false;
  if (open === undefined && minutes(time) < 18 * 60 && place.tags?.some(tag => /concert.hall|live.music.venue|night.?club/i.test(`${tag.id} ${tag.name}`))) return false;
  return true;
}

function classificationText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[_:/-]/g, " ");
}

/** "No museums" excludes museum/gallery classifications, not the whole culture category. */
export function isMuseumPlace(place: Place): boolean {
  const classifiers = [...(place.classifications ?? []), ...(place.tags ?? []).flatMap(tag => [tag.id, tag.name])];
  if (classifiers.some(value => /museum|museu|museo|musee|\bgaller(?:y|ies)\b/.test(classificationText(value)))) return true;
  // Last resort for incomplete provider taxonomy, including German compound museum names.
  return /museum|museu|museo|musee/.test(classificationText(place.name));
}

export function excludedPlace(place: Place, options: PlanOptions): boolean {
  if (options.exclude?.includes(place.id) || options.excludeCategories?.includes(place.category)) return true;
  if (options.excludeTags?.some(tag => /museum|museu|museo|musee/.test(classificationText(tag))) && isMuseumPlace(place)) return true;
  const normalize = (value: string) => classificationText(value).replace(/s\b/g, "").trim();
  const tags = [...(place.classifications ?? []), ...(place.tags ?? []).flatMap(tag => [tag.id, tag.name])].map(normalize);
  return (options.excludeTags ?? []).some(tag => tags.some(value => value === normalize(tag) || value.split(" ").includes(normalize(tag))));
}

export function missingReason(slot: ScheduledSlot, used: Set<string>, options: PlanOptions): "none_nearby" | "closed" | "over_budget" | "unsuitable_time" {
  const pool = slot.area.places.filter(p => slot.categories.includes(p.category) && !used.has(p.id) && !excludedPlace(p, options));
  if (!pool.length) return "none_nearby";
  const affordable = pool.filter(p => withinBudget(p, options.budget));
  return !affordable.length ? "over_budget" : affordable.every(p => isOpen(p, slot.date, slot.time) === false) ? "closed" : "unsuitable_time";
}

function words(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Explain the observed failure, never infer closure from an empty candidate list. */
export function planDayNote(day: Itinerary["days"][number], recovery?: string): string | undefined {
  const missing = day.missing.filter(slot => !slot.startsWith("Couldn't fit "));
  const includes = day.missing.filter(slot => slot.startsWith("Couldn't fit "));
  const count = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"][missing.length] ?? String(missing.length);
  const description = `${count} ${missing.every(slot => /dinner|evening/i.test(slot)) ? "evening" : "planned"} ${missing.length === 1 ? "slot" : "slots"}`;
  const sentences: string[] = [];
  if (recovery) sentences.push(recovery);
  else if (!day.stops.length) sentences.push(`Homing couldn't find places that fit you near ${day.neighborhood} for this day.`);
  else if (missing.length) sentences.push(`Homing couldn't find places that fit you for ${description} near ${day.neighborhood}.`);
  else if (day.stops.some(stop => stop.reasonCodes?.includes("relaxed_category"))) sentences.push("Homing used a different kind of place for some stops to fill the day.");
  if (recovery && missing.length && day.stops.length) sentences.push(`It left ${description} open.`);
  for (const reason of ["closed", "over_budget", "unsuitable_time"] as const) {
    const slots = [...new Set((day.issues ?? []).filter(issue => issue.reason === reason).map(issue => issue.slot.toLowerCase()))];
    if (!slots.length) continue;
    const when = words(slots);
    sentences.push(reason === "closed" ? `The matching places for ${when} are closed at the planned times.`
      : reason === "over_budget" ? `The matching places for ${when} are above your budget.`
        : `The available times didn't work for ${when}.`);
  }
  sentences.push(...includes.map(note => `${note.replace(/\.$/, "")}.`));
  if (!day.stops.length) sentences.push("Try another area or a different start time.");
  return sentences.length ? sentences.join(" ") : undefined;
}

export function planFromPlaces(days: 1 | 2 | 3, areas: PlanArea[], now: Date = new Date(), options: PlanOptions = {}): Itinerary {
  // A separate, completed baseline supplies preferences only. Excluded places never
  // enter the real candidate pools, including includes, timing repair and relaxation.
  const preferred = options.exclude?.length
    ? buildPlan(days, areas, now, { ...options, exclude: undefined }).placements : undefined;
  return buildPlan(days, areas, now, options, preferred).itinerary;
}

function buildPlan(days: 1 | 2 | 3, areas: PlanArea[], now: Date, options: PlanOptions, preferred?: (Place | undefined)[]): { itinerary: Itinerary; placements: (Place | undefined)[] } {
  if (!areas.length) throw apiError("bad_input", "Select at least one neighborhood.");
  const eligibleAreas = areas.map(area => ({ ...area, places: area.places.filter(place => !excludedPlace(place, options)) }));
  const slots: ScheduledSlot[] = Array.from({ length: days }, (_, day) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day + 1));
    return planSlots(options.pace, options.startHour).map((slot) => ({ ...slot, day, date, area: eligibleAreas[Math.min(day, eligibleAreas.length - 1)] }));
  }).flat();
  const used = new Set<string>();
  for (const [index, place] of (preferred ?? []).entries()) {
    if (place && !excludedPlace(place, options) && !used.has(place.id)) {
      slots[index].place = place;
      used.add(place.id);
    }
  }
  const missingIncludes: string[] = [];
  // Reserve requested places before ordinary choices, starting with the earliest compatible day/slot.
  for (const id of [...new Set(options.include ?? [])]) {
    if (used.has(id)) continue;
    const place = areas.flatMap((area) => area.places).find((item) => item.id === id);
    let reason: string | undefined;
    if (options.exclude?.includes(id) || (place && excludedPlace(place, options))) reason = "excluded from this plan";
    else if (!place) reason = "not available in the selected neighborhoods";
    else if (!withinBudget(place, options.budget)) reason = "above your budget";
    else {
      const compatible = slots.filter((slot) => slot.categories.includes(place.category) && slot.area.places.some((item) => item.id === id));
      const open = compatible.filter((slot) => suitableAt(place, slot.date, slot.time));
      const target = open.find((slot) => !slot.place);
      if (target) { target.place = place; used.add(id); }
      else reason = compatible.length && !open.length
        ? compatible.every(slot => isOpen(place, slot.date, slot.time) === false) ? "closed at the available times" : "not suitable at the available times"
        : `no available ${place.category} slot`;
    }
    if (reason) missingIncludes.push(`Couldn't fit ${place?.name ?? id}: ${reason}`);
  }
  // Reserve surviving baseline stops before filling any holes, across every day.
  let previous: Place | undefined;
  let previousDay = -1;
  for (const slot of slots) {
    if (slot.day !== previousDay) previous = undefined;
    if (!slot.place) {
      slot.place = slotCandidates(slot, used, options, previous)[0];
      if (slot.place) used.add(slot.place.id);
    }
    if (slot.place) previous = slot.place;
    previousDay = slot.day;
  }
  const reserved = used;
  const itinerary = { days: Array.from({ length: days }, (_, day) => {
    const today = slots.filter((slot) => slot.day === day);
    const date = today[0].date;
    const result: Itinerary["days"][number] = { date: date.toISOString().slice(0, 10), weekday: WEEKDAYS[date.getUTCDay()], neighborhood: today[0].area.name, stops: [], missing: [], issues: [] };
    let previous: Place | undefined;
    let travel = 0;
    for (const slot of today) {
      const reasonCodes: string[] = [];
      if (slot.place && !slot.categories.includes(slot.place.category)) reasonCodes.push("relaxed_category");
      if (!slot.place && options.relaxCategories) {
        const reason = missingReason(slot, reserved, options);
        slot.place = slotCandidates({ ...slot, categories: ["coffee", "culture", "food", "drinks"] }, reserved, options, previous)[0];
        if (slot.place) { reserved.add(slot.place.id); reasonCodes.push(reason, "relaxed_category"); }
      }
      if (!slot.place) {
        result.missing.push(slot.slot); result.issues!.push({ slot: slot.slot, reason: missingReason(slot, reserved, options) }); continue;
      }
      let walk = previous ? Math.round(walkMinutes([previous.lon, previous.lat], [slot.place.lon, slot.place.lat])) : 0;
      let arrival = minutes(slot.time) + travel + walk;
      // Check the actual arrival after walking, not the nominal slot time.
      if (arrival >= 24 * 60 || isOpen(slot.place, date, timeLabel(arrival)) === false) {
        const timingReason = arrival >= 24 * 60 ? "unsuitable_time" : "closed";
        reserved.delete(slot.place.id);
        const replacement = slotCandidates({ ...slot, time: timeLabel(minutes(slot.time) + travel) }, reserved, options, previous)
          .find(p => {
            const at = minutes(slot.time) + travel + (previous ? Math.round(walkMinutes([previous.lon, previous.lat], [p.lon, p.lat])) : 0);
            return at < 24 * 60 && isOpen(p, date, timeLabel(at)) !== false;
          });
        if (!replacement) { slot.place = undefined; result.missing.push(slot.slot); result.issues!.push({ slot: slot.slot, reason: timingReason }); continue; }
        slot.place = replacement; reserved.add(replacement.id); reasonCodes.push(timingReason);
        walk = previous ? Math.round(walkMinutes([previous.lon, previous.lat], [replacement.lon, replacement.lat])) : 0;
        arrival = minutes(slot.time) + travel + walk;
      }
      const place = slot.place;
      travel += walk;
      result.stops.push({ time: timeLabel(arrival), slot: reasonCodes.includes("relaxed_category") ? "Alternative stop" : slot.slot, place,
        walkMin: walk, walkIsApproximate: true, reasonCodes,
        hoursNote: isOpen(place, date, timeLabel(arrival)) === true ? "open" : "hours not listed" });
      previous = place;
    }
    if (day === days - 1) result.missing.push(...missingIncludes);
    result.note = planDayNote(result);
    return result;
  }) };
  return { itinerary, placements: slots.map(slot => slot.place) };
}

export async function solvePlan(state: ExploreState, neighborhoodIds: string[], options: Pick<PlanOptions, "exclude" | "include" | "excludeCategories" | "excludeTags"> = {}, preferredNeighborhoods: Neighborhood[] = []): Promise<Itinerary> {
  return withQlooBudget(PLAN_QLOO_CALL_LIMIT, () => solvePlanBounded(state, neighborhoodIds, options, preferredNeighborhoods));
}

async function solvePlanBounded(state: ExploreState, neighborhoodIds: string[], options: Pick<PlanOptions, "exclude" | "include" | "excludeCategories" | "excludeTags">, preferredNeighborhoods: Neighborhood[]): Promise<Itinerary> {
  if (!neighborhoodIds.length || neighborhoodIds.length > 3) throw apiError("bad_input", "Select one to three neighborhoods.");
  const [ranking, evidence] = await Promise.all([rankNeighborhoods(state), getCityEvidence(state)]);
  const neighborhoods = [...new Map([...preferredNeighborhoods, ...ranking].map(n => [n.id, n])).values()];
  const selected = [...new Set(neighborhoodIds)].map((id) => {
    const neighborhood = neighborhoods.find((item) => item.id === id);
    if (!neighborhood) throw apiError("not_found", "Neighborhood not found in this taste map.");
    return neighborhood;
  });
  const slots = planSlots(state.pace, state.startHour);
  const categories = [...new Set(slots.flatMap(slot => slot.categories))].filter(category => !options.excludeCategories?.includes(category));
  const now = new Date();
  const settings = { ...options, budget: state.budget, pace: state.pace, startHour: state.startHour };
  if (!categories.length) {
    const empty = planFromPlaces(state.days, selected.map(n => ({ id: n.id, name: n.name, places: [] })), now, settings);
    empty.days.forEach(day => { day.note = "Your exclusions leave no kinds of places to schedule for this day. Remove an exclusion to build a plan."; });
    return empty;
  }
  const areas = await Promise.all(selected.slice(0, state.days).map(async (neighborhood) => ({
    id: neighborhood.id, name: neighborhood.name,
    places: await placesNear({ ...state, budget: null }, neighborhood, [...categories, ...(options.include?.length && !options.excludeCategories?.includes("stay") ? ["stay" as const] : [])],
      [...evidence.fingerprint.you, ...(evidence.fingerprint.them ?? [])]),
  })));
  // A must-include need not be in a top-ten category sample. Fetch its actual Qloo row,
  // verify both ID and city distance, and add it to the nearest selected area's candidate pool.
  const absent = (options.include ?? []).filter(id => !options.exclude?.includes(id) && !areas.some(area => area.places.some(p => p.id === id)));
  if (absent.length) {
    const response = await qlooGet("/v2/insights", { "filter.type": "urn:entity:place", "filter.entities": absent.join(","), take: 12 });
    for (const row of resultRows(response, "entities")) {
      if (!absent.includes(string(row.entity_id) ?? "")) continue;
      const point = coordinates(row);
      const category = bestCategory(row);
      if (!point || !category) continue;
      const nearest = selected.map((n, i) => ({ i, distance: haversine(n.center, point) })).sort((a, b) => a.distance - b.distance)[0];
      const place = placeFromRow(row, category, [...evidence.fingerprint.you, ...(evidence.fingerprint.them ?? [])]);
      if (place && nearest.distance <= 15000 && areas[nearest.i]) areas[nearest.i].places.push(place);
    }
  }
  const result = planFromPlaces(state.days, areas, now, settings);
  // Excluded slots and unmet include warnings alone cannot trigger an expensive search.
  const needsRecovery = (day: Itinerary["days"][number]) => slots.some(slot => day.missing.includes(slot.slot)
    && slot.categories.some(category => categories.includes(category)));
  let attempts = 0;
  const alternateAreas = new Set<string>();
  let widened = false;
  const callsPerPool = categories.reduce((sum, category) => sum + CATEGORY_TAGS[category].length, 0);
  return withQlooBudget(MAX_RECOVERY_QLOO_CALLS, async () => {
    for (let day = 0; day < result.days.length; day++) {
      if (!needsRecovery(result.days[day])) continue;
      const original = result.days[day];
      const initial = selected[Math.min(day, selected.length - 1)];
      const used = result.days.flatMap((d, i) => i === day ? [] : d.stops.map(s => s.place.id));
      const date = new Date(now); date.setUTCDate(date.getUTCDate() + day);
      const candidates = [
        ...neighborhoods.filter(n => !selected.some(s => s.id === n.id) && !alternateAreas.has(n.id)).slice(0, 3 - alternateAreas.size).map(n => ({ n, radius: 900, relax: false, note: `Homing couldn't fill this day with places that fit you near ${initial.name}, so it used ${n.name} instead.`, code: "relaxed_neighborhood" })),
        ...(!widened ? [{ n: initial, radius: 2200, relax: true, note: `Homing looked farther around ${initial.name} and allowed a looser match to your place preferences.`, code: "relaxed_preferences" }] : []),
      ];
      let limited = !candidates.length;
      for (const attempt of candidates) {
        if (attempts >= MAX_RECOVERY_ATTEMPTS || remainingQlooCalls() < callsPerPool) { limited = true; break; }
        attempts++;
        if (attempt.radius > 900) widened = true; else alternateAreas.add(attempt.n.id);
        let places: Place[];
        try {
          places = await placesNear({ ...state, budget: null, ...(attempt.relax ? { refinements: [] } : {}) }, attempt.n,
            categories, [...evidence.fingerprint.you, ...(evidence.fingerprint.them ?? [])], { radius: attempt.radius, take: 20, perCategory: 20 });
        } catch (error) {
          if (remainingQlooCalls() > 0) throw error;
          limited = true; break;
        }
        const candidate = planFromPlaces(1, [{ id: attempt.n.id, name: attempt.n.name, places }], date,
          { ...settings, include: options.include?.filter(id => !used.includes(id)), exclude: [...(options.exclude ?? []), ...used], relaxCategories: attempt.relax }).days[0];
        const required = (d: Itinerary["days"][number]) => d.stops.filter(s => options.include?.includes(s.place.id)).length;
        if (candidate.stops.length > result.days[day].stops.length && required(candidate) >= required(result.days[day])) {
          candidate.note = planDayNote(candidate, attempt.note);
          candidate.stops.forEach(stop => { stop.reasonCodes = [...new Set([...(stop.reasonCodes ?? []), ...original.issues?.map(i => i.reason) ?? [], attempt.code])]; });
          result.days[day] = candidate;
        }
        if (!needsRecovery(result.days[day])) break;
      }
      if (needsRecovery(result.days[day]) && (limited || attempts >= MAX_RECOVERY_ATTEMPTS || remainingQlooCalls() < callsPerPool))
        result.days[day].note = planDayNote(result.days[day], `Homing couldn't finish this day near ${initial.name} within this search. Try planning this day on its own.`);
      else if (!result.days[day].stops.length) result.days[day].note = planDayNote(result.days[day],
        `Homing couldn't find places that fit you near ${initial.name} for this day after checking nearby options.`);
    }
    return result;
  });
}
