/** FICTIONAL UI FIXTURES ONLY. No Qloo observations or real recommendations.
 * Every entity/area ID starts fictional:. Never import this file into runtime API,
 * production components, screenshots presented as live evidence, or warmup scripts.
 * Two scenarios: FICTIONAL_COMPLETE_09 and FICTIONAL_PARTIAL_09.
 */
import { ExploreState } from "./contracts";
import {
  AgentEventV2, CitiesResponseV2, DecidesResponseV2, FieldResponseV2, HomeResponseV2,
  NeighborhoodsResponseV2, PlacesResponseV2, PlanResponseV2, SpotResponseV2, emptySessionMemory,
  type AreaDecision, type EvidenceRef, type ResultMeta, type Support, type VenueEvidence,
} from "./contracts-09";

export const FICTIONAL_NOTICE_09 = "Fictional UI fixture. Names, coordinates and numbers are invented for interface development.";
const when = "2026-10-30T00:00:00.000Z";
const evidence: EvidenceRef[] = [{ id: "fictional:evidence", kind: "derived", fetchedAt: when, requestHash: "fictional:no-provider-request", methodVersion: "fictional:ui-only" }];
const evidenceIds = evidence.map(e => e.id);
const meta: ResultMeta = { responseVersion: 2, analysisId: "fictional:analysis", profileHash: "fictional:profile", stateRevision: 1, cityId: "fictional:city", manifestVersion: "fictional:manifest", methodVersion: "fictional:ui-only", generatedAt: when, dataAsOf: when, cache: "fresh", status: "complete" };
const support: Support = { quality: "sufficient", activeLoveWeightCovered: 1, observedAreaShare: 0.76, spatialBlocks: 9, eligibleVenueCount: 3, categoryCount: 3, missingSignals: [], notes: [FICTIONAL_NOTICE_09] };
const state = ExploreState.parse({ city: "Fictional Harbor City", loves: [{ query: "Fictional Evening Quartet", chosen: { id: "fictional:artist", name: "Fictional Evening Quartet", domain: "artist" }, candidates: [], weight: 1 }], days: 1, pace: "relaxed" });
function venue(id: string, name: string, role: "coffee" | "food" | "culture", lon: number): VenueEvidence {
  return { place: { id: `fictional:${id}`, name: `Fictional ${name}`, category: role, lat: 38.72, lon, affinity: 0.7, popularity: 0.4, priceLevel: 2, why: ["Fictional evidence for layout testing."], mapsUrl: "https://example.invalid/fictional-place", tags: [] }, role, venueKey: `fictional:${id}`, insideArea: true, eligibility: "eligible", priceStatus: "known_within", hoursStatus: "unknown", connections: [{ placeId: `fictional:${id}`, loveId: "fictional:artist", providerContribution: 0.64, sharedTagIds: [], explanationKind: "provider", evidenceIds }], limitations: ["Opening hours have not been checked.", FICTIONAL_NOTICE_09], evidenceIds };
}
const venues = [venue("cafe", "Paper Café", "coffee", -9.14), venue("kitchen", "Harbor Kitchen", "food", -9.141), venue("gallery", "Lantern Gallery", "culture", -9.142)];
const areas: AreaDecision[] = ["Lantern Quarter", "Paper Gardens", "Harbor Steps"].map((name, index) => ({
  area: { id: `fictional:area-${index + 1}`, name: `Fictional ${name}`, aliases: [], center: [-9.14 + index * 0.01, 38.72], geometry: { kind: "circle", radiusM: 650 }, geometryQuality: "approximate" },
  metrics: { tasteScore: 0.68 - index * 0.06, rank: index + 1, candidateCount: 12, percentile: 92 - index * 8, tieBand: false, support },
  recommendationStatus: "recommended", headline: "Three places to try for an everyday afternoon.", tradeoff: "The area is approximate; opening hours still need checking.", anchors: venues, evidenceIds,
}));
const field = { city: state.city, center: [-9.14, 38.72], bbox: [-9.15, 38.71, -9.13, 38.73], cells: [{ h: "fictional-cell", lat: 38.72, lon: -9.14, you: 0.68, popularity: 0.4, drivers: { artist: 1 }, support: 1, signalKind: "affinity_rank" }], sparse: false, signalsWithoutGeo: [] };
const matches = areas.map((area, index) => ({ area, similarity: { value: 72 - index * 9, method: "style_only_v1" as const, referenceVersion: "fictional:reference", support: "sufficient" as const }, orderReason: "home_similarity" as const, sharedFeatures: [{ tagId: "fictional:tag", label: "Fictional intimate spaces", evidenceIds }], counterparts: [{ sourcePlaceId: "fictional:old-cafe", target: venues[0] }] }));
const audit = { hardViolations: [], unmet: [], warnings: ["Opening hours have not been checked."] };
const neighborhoods = NeighborhoodsResponseV2.parse({ meta, areas, allCandidateIds: areas.map(a => a.area.id), evidence });
const home = HomeResponseV2.parse({ meta, sourceSignatureSummary: { area: { ...areas[0].area, id: "fictional:source-area", name: "Fictional Old Quarter" }, cityId: "fictional:old-city", cityName: "Fictional Old City", referenceVersion: "fictional:reference", method: "style_only_v1", support: "sufficient", venueCount: 12, categoryCounts: { coffee: 4, food: 4, culture: 4 }, missingFamilies: ["musicTaste"], representatives: venues, features: [{ tagId: "fictional:tag", label: "Fictional intimate spaces", family: "placeStyle", weight: 1 }], evidenceIds }, matches, field, evidence });
const address = SpotResponseV2.parse({ meta, label: "Fictional Lantern Street", point: [-9.14, 38.72], geocodeQuality: "street", area: areas[0], outsideSelectedArea: false, nearby: venues.map((v, i) => ({ venue: v, walkMinutes: 3 + i * 2, approximate: true })), constraintsAudit: audit, evidenceIds, evidence });
const constraints = [{ id: "fictional:no-bars", kind: "exclude_type", value: "bar", strength: "hard", source: "user" }, { id: "fictional:budget", kind: "budget", value: 2, strength: "hard", source: "user" }];
const visit = PlanResponseV2.parse({ meta, itinerary: { days: [{ neighborhood: areas[0].area.name, stops: venues.map((v, i) => ({ time: ["14:00", "15:10", "16:20"][i], slot: ["Afternoon coffee", "Late lunch", "Gallery visit"][i], place: v.place, walkMin: i === 0 ? 0 : 5, hoursNote: "hours not listed", walkIsApproximate: true })), missing: [] }] }, constraints, venueEvidence: Object.fromEntries(venues.map(v => [v.place.id, v])), audit, recoveryLog: [], evidenceIds, evidence });
const explanation = DecidesResponseV2.parse({ meta, baseOrder: areas.map(a => a.area.id), ablations: [{ areaId: areas[0].area.id, loveId: "fictional:artist", baseRank: 1, withoutRank: null, deltaTasteScore: 0.18, tieChanged: true }], claims: [{ text: "This fictional example has only one love, so removing it leaves no taste ranking.", evidenceIds }], evidence });
const comparison = CitiesResponseV2.parse({ meta, criteria: ["home_similarity", "everyday_venues", "support"], referenceVersion: "fictional:reference", method: "home_style_only_v1", results: [{ cityId: "fictional:city", cityName: state.city, status: "ok", areas, homeMatches: matches, culturalOverlap: 63, eligibleCategories: ["coffee", "food", "culture"], support: "sufficient", evidenceIds }, { cityId: "fictional:other-city", cityName: "Fictional Hill City", status: "partial", areas: [], culturalOverlap: null, eligibleCategories: ["coffee"], support: "limited", evidenceIds }], recommendation: null, evidence });
const goals = [{ id: "fictional:choose", kind: "choose_area", status: "satisfied", resultIds: [meta.analysisId], unmet: [] }] as const;
const events = [
  { type: "ack", turnId: "fictional:turn", text: "I’ll look for areas and check their everyday places." },
  { type: "plan", turnId: "fictional:turn", goals: goals.map(g => ({ ...g, status: "pending", resultIds: [] })), steps: ["Compare areas", "Check everyday places"] },
  { type: "step", turnId: "fictional:turn", stepId: "fictional:rank", status: "done", text: "Compared 12 fictional areas." },
  { type: "result", turnId: "fictional:turn", meta, card: { kind: "areas", areas } },
  { type: "answer", turnId: "fictional:turn", claims: [{ text: "This is a fictional result for interface development.", evidenceIds }] },
  { type: "done", turnId: "fictional:turn", goals, memory: emptySessionMemory(1) },
].map(event => AgentEventV2.parse(event));

export const FICTIONAL_COMPLETE_09 = { fictional: true as const, notice: FICTIONAL_NOTICE_09, state, meta, field: FieldResponseV2.parse({ meta, field, support }), neighborhoods, home, places: PlacesResponseV2.parse({ meta, venues, rejectedByReason: {}, unmet: [], evidence }), address, visit, explanation, comparison, events };

const partialMeta: ResultMeta = { ...meta, analysisId: "fictional:partial-analysis", status: "partial" };
const partialSupport: Support = { ...support, quality: "limited", activeLoveWeightCovered: 0.3, observedAreaShare: 0.12, spatialBlocks: 2, eligibleVenueCount: 1, categoryCount: 1, missingSignals: [{ query: "Fictional missing love", reason: "unavailable" }], notes: [FICTIONAL_NOTICE_09, "One signal could not be retrieved."] };
const partialAreas = areas.map(area => ({ ...area, metrics: { ...area.metrics, percentile: null, tieBand: true, support: partialSupport }, recommendationStatus: "needs_checking" as const, anchors: venues.slice(0, 1), headline: "A possible starting point with limited evidence." }));
export const FICTIONAL_PARTIAL_09 = {
  fictional: true as const, notice: FICTIONAL_NOTICE_09, state, meta: partialMeta,
  neighborhoods: NeighborhoodsResponseV2.parse({ meta: partialMeta, areas: partialAreas, allCandidateIds: areas.map(a => a.area.id), evidence }),
  places: PlacesResponseV2.parse({ meta: partialMeta, venues: venues.slice(0, 1), rejectedByReason: { budget_unknown: 4, excluded_type: 2 }, unmet: ["No second category with a known price was found."], evidence }),
  visit: PlanResponseV2.parse({ ...visit, meta: partialMeta, itinerary: { days: [{ neighborhood: areas[0].area.name, stops: visit.itinerary.days[0].stops.slice(0, 1), missing: ["Food", "Culture"] }] }, audit: { ...audit, unmet: [{ goalId: "fictional:visit", reason: "Two requested roles have no verified eligible venue.", recoverable: true }] }, recoveryLog: [{ reason: "Two roles were missing in the first search.", action: "wider_radius", affectedGoalIds: ["fictional:visit"], changedStopIds: [] }] }),
  events: [
    { type: "ack", turnId: "fictional:partial-turn", text: "I’ll keep your venue restrictions while checking nearby options." },
    { type: "observation", turnId: "fictional:partial-turn", goalId: "fictional:visit", text: "Two roles have no place with a known acceptable price.", evidenceIds },
    { type: "replan", turnId: "fictional:partial-turn", reason: "The nearby search could not fill two roles.", nextAction: "Check a wider radius with the same price and type restrictions." },
    { type: "error", turnId: "fictional:partial-turn", goalId: "fictional:visit", retryable: true, message: "The visit is partial. The remaining roles need checking." },
    { type: "done", turnId: "fictional:partial-turn", goals: [{ id: "fictional:visit", kind: "build_visit", status: "partial", resultIds: [partialMeta.analysisId], unmet: ["Two roles remain unfilled."] }], memory: { ...emptySessionMemory(1), constraints } },
  ].map(event => AgentEventV2.parse(event)),
};
