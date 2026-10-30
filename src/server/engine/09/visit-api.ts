import { apiError, type ExploreState, type Itinerary } from "@/shared/contracts";
import type { AuditV2, Constraint, EvidenceRef, PlaceIntentV2, PlanRequestV2, PlanResponseV2, VenueEvidence, VisitResultV2 } from "@/shared/contracts-09";
import { walkMinutes } from "../geo";
import { minutes, timeLabel } from "../plan";
import { WEEKDAYS } from "../places";
import { hash, normalized, resultMeta, uniqueEvidence } from "./core";
import { brandKey, intentRole, venueEligibility } from "./eligibility";
import { pointInArea } from "./geometry";
import { cityManifest, type CityManifest, type ManifestArea } from "./manifest";
import { effectiveConstraints, loadVenuePool, musicIntent, type VenuePool } from "./venues-api";
import { auditVenueRequirements, requiredVenueRoles } from "./address-api";

export const VISIT_METHOD = "bounded-distinct-venue-visit-v2";
// Equal normalized names at different addresses are one day-level choice even
// when the provider omits a chain ID (for example two branches of one cafe).
const visitBrand = (v: VenueEvidence) => v.brandKey ?? brandKey(v.place) ?? `name:${normalized(v.place.name)}`;
type VisitSlot = { label: string; intent: PlaceIntentV2; stay: number; earliest: number; fixedId?: string };
export type VisitPool = { area: ManifestArea; venues: VenueEvidence[]; radiusM: number };
const processGlobal = globalThis as typeof globalThis & { __homingVisit09?: Map<string, PlanResponseV2> };
const savedVisits: Map<string, PlanResponseV2> = processGlobal.__homingVisit09 ??= new Map<string, PlanResponseV2>();
export function visitDate(input?: string, now = new Date()): Date {
  const today = now.toISOString().slice(0, 10);
  const date = input ? new Date(`${input}T00:00:00.000Z`) : new Date(`${today}T00:00:00.000Z`);
  if (!input) date.setUTCDate(date.getUTCDate() + 1);
  if (!Number.isFinite(date.getTime()) || (input && date.toISOString().slice(0, 10) !== input) || date.toISOString().slice(0, 10) < today) throw apiError("bad_input", "Choose a valid date today or later for this visit.");
  return date;
}
function excludedRole(intent: PlaceIntentV2, constraints: Constraint[]): boolean {
  return constraints.some(c => {
    const value = normalized(String(c.value));
    return c.strength === "hard" && c.kind === "exclude_type" && !/adult|strip|hotel|lodging/.test(value) && (value === intent ||
      (intent === "bar" || intent === "dance") && /\b(?:bars?|pubs?|clubs?|nightlife)\b/.test(value));
  });
}
export function visitSlots(state: ExploreState, constraints: Constraint[], prior?: Itinerary["days"][number], replacePlaceId?: string, startHour = state.startHour): VisitSlot[] {
  if (prior) return prior.stops.map(stop => ({ label: stop.slot, intent: intentRole("daily_life", stop.place) ?? (stop.place.category === "drinks" ? "bar" : stop.place.category === "stay" ? "culture" : stop.place.category),
    stay: stop.place.category === "culture" ? 60 : 45, earliest: minutes(stop.time), ...(stop.place.id !== replacePlaceId ? { fixedId: stop.place.id } : {}) }));
  const slots: VisitSlot[] = [{ label: "Coffee and a look around", intent: "coffee", stay: 45, earliest: startHour * 60 }, { label: "Explore the neighborhood", intent: "culture", stay: 60, earliest: 0 }, { label: "A local meal", intent: "food", stay: 60, earliest: 12 * 60 }];
  if (state.pace === "packed") slots.splice(2, 0, { label: "Another place to explore", intent: "culture", stay: 45, earliest: 0 });
  for (const role of requiredVenueRoles(constraints)) if (!slots.some(s => s.intent === role)) slots.push({ label: role === "dance" ? "A venue for dancing" : "A live music venue", intent: role as PlaceIntentV2, stay: 75, earliest: 20 * 60 });
  return slots.filter(s => !excludedRole(s.intent, constraints));
}
/** Pure deterministic schedule. Existing stops are protected before choosing a replacement. */
export function scheduleVisit(input: PlanRequestV2, pools: VisitPool[], constraints: Constraint[], date: Date, fixed: VenueEvidence[] = []): VisitResultV2 {
  const itinerary: Itinerary = { days: [] };
  const venueEvidence: Record<string, VenueEvidence> = {};
  const used = new Set<string>(), usedKeys = new Set<string>();
  const excluded = [...new Set([...input.excludeIds, ...(input.replacePlaceId ? [input.replacePlaceId] : [])])];
  const prior = input.existingItinerary;
  const protectedIds = new Set([...(prior?.days.flatMap(d => d.stops.map(s => s.place.id)) ?? []), ...input.includeIds].filter(id => !excluded.includes(id)));
  const audit: AuditV2 = { hardViolations: [], unmet: [], warnings: [] };
  const dayCount = prior?.days.length ?? input.state.days;
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const pool = pools[Math.min(dayIndex, pools.length - 1)];
    const dayDate = new Date(date); dayDate.setUTCDate(dayDate.getUTCDate() + dayIndex);
    const weekday = WEEKDAYS[dayDate.getUTCDay()];
    const previousGaps = prior?.days[dayIndex]?.missing ?? [];
    const day: Itinerary["days"][number] = { date: dayDate.toISOString().slice(0, 10), weekday, neighborhood: pool.area.identity.name, stops: [], missing: [...previousGaps], issues: [...(prior?.days[dayIndex]?.issues ?? [])] };
    for (const gap of previousGaps) audit.unmet.push({ goalId: `visit:day${dayIndex + 1}:previous-gap`, reason: `The previous visit still has an unfilled stop: ${gap}.`, recoverable: true });
    const slots = visitSlots(input.state, constraints, prior?.days[dayIndex], input.replacePlaceId, input.startHour);
    if (!prior && dayIndex === 0) for (const included of fixed.filter(v => input.includeIds.includes(v.place.id))) {
      const slot = slots.find(s => !s.fixedId && (s.intent === included.role || s.intent === "concert" && included.role === "live_music"));
      if (slot) slot.fixedId = included.place.id;
      else slots.push({ label: "Your saved place", intent: included.role, stay: 45, earliest: musicIntent(included.role) ? 20 * 60 : 0, fixedId: included.place.id });
    }
    const brands = new Set<string>();
    let at = (input.startHour ?? input.state.startHour) * 60;
    for (const slot of slots) {
      const previous = day.stops.at(-1);
      const candidates = [...fixed, ...pool.venues].filter((v, i, all) => all.findIndex(other => other.place.id === v.place.id) === i)
        .filter(v => !used.has(v.place.id) && !usedKeys.has(v.venueKey) && !brands.has(visitBrand(v)) && pointInArea([v.place.lon, v.place.lat], pool.area.identity) && (slot.fixedId ? v.place.id === slot.fixedId : !protectedIds.has(v.place.id)))
        .map(v => {
          const walk = previous ? walkMinutes([previous.place.lon, previous.place.lat], [v.place.lon, v.place.lat]) : 0;
          const time = Math.ceil(Math.max(at + walk, slot.earliest) / 5) * 5;
          const eligibility = venueEligibility(v.place, slot.intent, constraints, { center: pool.area.identity.center, radiusM: pool.radiusM, excludeIds: excluded, weekday, minute: time, stayMinutes: slot.stay, requireKnownBudget: true });
          return { v, time, walk, eligibility };
        }).filter(c => c.eligibility.allowed && c.time + slot.stay <= 23 * 60 + 30 && (!musicIntent(slot.intent) || c.time >= 18 * 60));
      // Pool order encodes taste/requirements; a short walk breaks close affinity ties.
      candidates.sort((a, b) => Math.abs(a.v.place.affinity - b.v.place.affinity) < .02
        ? Number(b.eligibility.priceStatus === "known_within") - Number(a.eligibility.priceStatus === "known_within") || a.walk - b.walk : 0);
      const chosen = candidates[0];
      if (!chosen) {
        day.missing.push(slot.label);
        const reason = slot.fixedId ? "The retained place could not be revalidated for this slot and its constraints." : "No eligible venue is available for this role, time and set of constraints.";
        day.issues!.push({ slot: slot.label, reason });
        audit.unmet.push({ goalId: `visit:day${dayIndex + 1}:${slot.intent}`, reason, recoverable: !slot.fixedId });
        continue;
      }
      const { v, time, walk, eligibility } = chosen;
      const checked = { ...v, role: eligibility.role!, priceStatus: eligibility.priceStatus, hoursStatus: eligibility.hoursStatus, limitations: [...new Set([...v.limitations, ...eligibility.limitations])].filter(l => eligibility.hoursStatus !== "known_open" || !l.startsWith("Opening hours")) };
      venueEvidence[v.place.id] = checked;
      day.stops.push({ time: timeLabel(time), slot: slot.label, place: v.place, walkMin: Math.ceil(walk), hoursNote: eligibility.hoursStatus === "known_open" ? "open" : "hours not listed", walkIsApproximate: true,
        reasonCodes: [...(!v.insideArea ? ["outside_selected_area"] : []), ...(eligibility.hoursStatus === "event_required" ? ["event_schedule_unverified"] : [])] });
      used.add(v.place.id); usedKeys.add(v.venueKey); brands.add(visitBrand(v));
      at = time + slot.stay;
    }
    day.note = "Walking times are estimates. Check current hours and admission before setting out.";
    if (!day.stops.length) day.note = "No stops met the requested constraints for this day.";
    itinerary.days.push(day);
  }
  for (const id of input.includeIds) if (!used.has(id)) audit.unmet.push({ goalId: "visit:include", reason: `Requested place ${id} could not be included with these constraints.`, recoverable: false });
  const requirements = auditVenueRequirements(Object.values(venueEvidence), constraints, "build_visit");
  audit.unmet.push(...requirements.unmet); audit.warnings.push(...requirements.warnings);
  return { itinerary, constraints, venueEvidence, audit, recoveryLog: [], evidenceIds: [...new Set(Object.values(venueEvidence).flatMap(v => v.evidenceIds))] };
}
export function auditVisit(result: VisitResultV2, input: PlanRequestV2): AuditV2 {
  const audit = structuredClone(result.audit);
  const required = effectiveConstraints(input.state, input.constraints);
  for (const constraint of required.filter(c => c.strength === "hard")) if (!result.constraints.some(c => c.kind === constraint.kind && c.value === constraint.value && c.strength === "hard")) {
    audit.hardViolations.push({ constraintId: constraint.id, reason: "A requested hard constraint is missing from this visit." });
  }
  const ids = new Set<string>(), keys = new Set<string>();
  const excluded = [...input.excludeIds, ...(input.replacePlaceId ? [input.replacePlaceId] : [])];
  for (const [dayIndex, day] of result.itinerary.days.entries()) {
    const brands = new Set<string>(); let previous = -Infinity;
    for (const stop of day.stops) {
      const venue = result.venueEvidence[stop.place.id];
      const fail = (reason: string, constraintId = "visit:integrity") => audit.hardViolations.push({ constraintId, placeId: stop.place.id, reason });
      if (!venue) { fail("The stop has no verified venue evidence."); continue; }
      if (ids.has(stop.place.id) || keys.has(venue.venueKey)) fail("The same venue is repeated.");
      if (brands.has(visitBrand(venue))) fail("A chain or venue name is repeated on the same day.");
      if (!venue.insideArea) fail("A stop is outside the selected area.");
      if (minutes(stop.time) <= previous) fail("Visit times are not increasing.");
      previous = minutes(stop.time); ids.add(stop.place.id); keys.add(venue.venueKey); brands.add(visitBrand(venue));
      if (stop.place.id !== venue.place.id || stop.place.lat !== venue.place.lat || stop.place.lon !== venue.place.lon || stop.place.name !== venue.place.name) fail("The displayed stop differs from its verified venue.");
      const gate = venueEligibility(venue.place, venue.role, required, { excludeIds: excluded, weekday: day.weekday, minute: minutes(stop.time), requireKnownBudget: true });
      for (const reason of gate.reasons) fail(reason);
    }
    if (!day.stops.length && !audit.unmet.some(u => u.goalId.startsWith(`visit:day${dayIndex + 1}:`))) audit.unmet.push({ goalId: `visit:day${dayIndex + 1}`, reason: "The requested day has no verified stops.", recoverable: true });
  }
  return audit;
}
async function initialPool(manifest: CityManifest, area: ManifestArea, input: PlanRequestV2, constraints: Constraint[], radiusM: number): Promise<VenuePool> {
  return loadVenuePool(manifest, input.state, { intent: "daily_life", constraints, center: area.identity.center, radiusM, area: area.identity, excludeIds: [...input.excludeIds, ...(input.replacePlaceId ? [input.replacePlaceId] : [])], deferHours: true });
}
export async function planV2(request: PlanRequestV2): Promise<PlanResponseV2> {
  const stored = request.existingPlanId ? savedVisits.get(request.existingPlanId) : undefined;
  const input: PlanRequestV2 = { ...request, existingItinerary: request.existingItinerary ?? stored?.itinerary };
  const { value: manifest } = await cityManifest(input.state.city);
  const areas = input.areaIds.map(id => manifest.areas.find(a => a.identity.id === id));
  if (areas.some(a => !a)) throw apiError("not_found", "An area is no longer in this city catalog. Choose the area again.");
  const selected = areas as ManifestArea[];
  const constraints = effectiveConstraints(input.state, input.constraints);
  const date = visitDate(input.date ?? input.existingItinerary?.days[0]?.date);
  const evidence: EvidenceRef[] = [...manifest.evidence];
  const batches = await Promise.all(selected.map(area => initialPool(manifest, area, input, constraints, 650)));
  const pools = batches.map((batch, i) => { evidence.push(...batch.evidence); return { area: selected[i], venues: batch.venues, radiusM: 650 }; });
  const retained = [...new Set([...input.includeIds, ...(input.existingItinerary?.days.flatMap(d => d.stops.map(s => s.place.id)) ?? [])])].filter(id => !input.excludeIds.includes(id) && id !== input.replacePlaceId);
  const fixed: VenueEvidence[] = [];
  if (retained.length) {
    const checked = await loadVenuePool(manifest, input.state, { intent: "daily_life", constraints, center: manifest.center, radiusM: manifest.radiusM, fixedIds: retained, excludeIds: input.excludeIds, deferHours: true });
    fixed.push(...checked.venues); evidence.push(...checked.evidence);
  }
  // Music roles need music-only signals; a generic daily-life pool is not enough evidence.
  for (const role of requiredVenueRoles(constraints).filter(r => r === "dance" || r === "live_music")) for (const pool of pools) {
    const music = await loadVenuePool(manifest, input.state, { intent: role as PlaceIntentV2, constraints, center: pool.area.identity.center, radiusM: 650, area: pool.area.identity, excludeIds: input.excludeIds, deferHours: true });
    pool.venues.push(...music.venues); evidence.push(...music.evidence);
  }
  let result = scheduleVisit(input, pools, constraints, date, fixed);
  const recoveryLog: VisitResultV2["recoveryLog"] = [];
  // At most one role search per gap, four searches total. No hard condition changes.
  let searches = 0;
  for (const [index, pool] of pools.entries()) {
    const requested = visitSlots(input.state, constraints, input.existingItinerary?.days[index], input.replacePlaceId, input.startHour);
    const gaps = result.itinerary.days.filter((_, dayIndex) => Math.min(dayIndex, pools.length - 1) === index).flatMap(day => day.missing);
    for (const slot of requested.filter(s => gaps.includes(s.label))) {
      if (searches++ >= 4) break;
      const recovery = await loadVenuePool(manifest, input.state, { intent: slot.intent, constraints, center: pool.area.identity.center, radiusM: 650, area: pool.area.identity, excludeIds: [...input.excludeIds, ...(input.replacePlaceId ? [input.replacePlaceId] : [])], deferHours: true });
      pool.venues.push(...recovery.venues); evidence.push(...recovery.evidence);
      recoveryLog.push({ reason: `Searched specifically for ${slot.intent.replace(/_/g, " ")} inside the selected area.`, action: "alternate_venue", affectedGoalIds: ["build_visit"], changedStopIds: [] });
    }
  }
  if (recoveryLog.length) result = scheduleVisit(input, pools, constraints, date, fixed);
  if (input.replacePlaceId) recoveryLog.unshift({ reason: "You asked to replace this stop while keeping the other verified stops.", action: "alternate_venue", affectedGoalIds: ["build_visit"], changedStopIds: [input.replacePlaceId] });
  if (result.audit.unmet.length) recoveryLog.push({ reason: "Some stops could not be filled without breaking your requirements.", action: "fewer_stops", affectedGoalIds: [...new Set(result.audit.unmet.map(u => u.goalId))], changedStopIds: [] });
  result.recoveryLog = recoveryLog; result.evidenceIds = uniqueEvidence(evidence).map(e => e.id);
  result.audit = auditVisit(result, input);
  if (result.audit.hardViolations.length) throw apiError("qloo_unavailable", "The visit could not pass its final constraints check. No unsafe replacement was returned.", true);
  const response: PlanResponseV2 = { ...result, meta: resultMeta(input, manifest, { method: VISIT_METHOD, partial: result.audit.unmet.length > 0, suffix: [input.areaIds, date.toISOString(), input.startHour, input.state.days, input.state.pace, input.includeIds, input.excludeIds, input.replacePlaceId, hash(input.existingItinerary ?? null)], dataAsOf: evidence.map(e => e.fetchedAt).sort()[0] }), evidence: uniqueEvidence(evidence) };
  savedVisits.set(response.meta.analysisId, structuredClone(response));
  if (savedVisits.size > 100) savedVisits.delete(savedVisits.keys().next().value!);
  return response;
}
