import { z } from "zod";
import { EntityRef, ExploreState, Itinerary, Place, StatePatch, TasteField } from "./contracts";

/** Stage 09 wire contracts. Scores are indices, never probabilities of liking an area.
 * Request v2 with { responseVersion: 2, state, stateRevision, ... } on existing routes.
 * Existing v1 contracts remain available in ./contracts during migration.
 */
export const RESPONSE_VERSION = 2 as const;
export const LonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type LonLat = z.infer<typeof LonLat>;
const Unit = z.number().min(0).max(1);
const Id = z.string().min(1).max(240);
const Timestamp = z.string().datetime();
export const Quality = z.enum(["sufficient", "limited", "unavailable"]);
export type Quality = z.infer<typeof Quality>;
export const EvidenceRef = z.object({
  id: Id, kind: z.enum(["qloo_heatmap", "qloo_entity", "qloo_explainability", "qloo_tags", "geocode", "derived"]),
  fetchedAt: Timestamp, requestHash: Id, entityIds: z.array(Id).optional(), methodVersion: z.string().optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;
export const ResultMeta = z.object({
  responseVersion: z.literal(2), analysisId: Id, profileHash: Id, stateRevision: z.number().int().nonnegative(),
  cityId: Id, manifestVersion: Id, methodVersion: Id, referenceVersion: Id.optional(),
  generatedAt: Timestamp, dataAsOf: Timestamp, cache: z.enum(["fresh", "hit", "stale"]),
  status: z.enum(["complete", "partial"]),
});
export type ResultMeta = z.infer<typeof ResultMeta>;
export const Support = z.object({
  quality: Quality, activeLoveWeightCovered: Unit, observedAreaShare: Unit, spatialBlocks: z.number().int().nonnegative(),
  eligibleVenueCount: z.number().int().nonnegative(), categoryCount: z.number().int().nonnegative(),
  missingSignals: z.array(z.object({ query: z.string(), reason: z.enum(["no_signal", "unavailable"]) })),
  notes: z.array(z.string()),
});
export type Support = z.infer<typeof Support>;
export const AreaIdentity = z.object({
  id: Id, name: z.string(), aliases: z.array(z.string()), center: LonLat,
  geometry: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("circle"), radiusM: z.number().positive() }),
    z.object({ kind: z.literal("polygon"), coordinates: z.array(z.array(LonLat).min(4)).min(1) }),
  ]), geometryQuality: z.enum(["verified", "approximate"]),
});
export type AreaIdentity = z.infer<typeof AreaIdentity>;
const PersonMetrics = z.object({ score: Unit, rank: z.number().int().positive(), support: Support });
export const AreaMetrics = z.object({
  /** Internal H; render rank, never 100 * tasteScore. */
  tasteScore: Unit, rank: z.number().int().positive(), candidateCount: z.number().int().positive(),
  /** Percentile denominator when fewer areas have sufficient support than candidateCount. */
  percentileCandidateCount: z.number().int().nonnegative().optional(),
  percentile: z.number().min(0).max(100).nullable(), tieBand: z.boolean(), support: Support,
  /** Explicit scope of the exploratory stage-08-style index. These fixed cells
   * provide district context; AreaIdentity.geometry remains the 650 m venue area. */
  rankingContext: z.object({ kind: z.literal("fixed_nearest_cells"), cellPrecision: z.literal(6), radiusM: z.literal(1600), cellCount: z.number().int().nonnegative(), observedCellCount: z.number().int().nonnegative() }).optional(),
  you: PersonMetrics.optional(), partner: PersonMetrics.optional(),
});
export type AreaMetrics = z.infer<typeof AreaMetrics>;
export const ConstraintStrength = z.enum(["hard", "soft"]);
export type ConstraintStrength = z.infer<typeof ConstraintStrength>;
export const Constraint = z.object({
  id: Id, kind: z.enum(["exclude_type", "exclude_place", "budget", "dietary", "hours", "distance", "ambience", "intent"]),
  value: z.union([z.string().max(240), z.number().finite()]), strength: ConstraintStrength, source: z.enum(["user", "default"]),
});
export type Constraint = z.infer<typeof Constraint>;
export const PlaceConnection = z.object({
  placeId: Id, loveId: Id, providerContribution: Unit.optional(), sharedTagIds: z.array(z.string()),
  explanationKind: z.enum(["provider", "local_weighted_rerank", "shared_tags"]), evidenceIds: z.array(Id),
});
export type PlaceConnection = z.infer<typeof PlaceConnection>;
export const VenueRole = z.enum(["coffee", "food", "bar", "dance", "live_music", "culture"]);
export type VenueRole = z.infer<typeof VenueRole>;
export const PlaceV2 = Place.extend({
  brandId: z.string().optional(), brandName: z.string().optional(), closed: z.boolean().optional(),
  primaryGenre: z.string().optional(), affinityRank: Unit.optional(),
  classificationWarnings: z.array(z.string()).optional(),
});
export type PlaceV2 = z.infer<typeof PlaceV2>;
export const VenueEvidence = z.object({
  place: PlaceV2, role: VenueRole, venueKey: Id, brandKey: z.string().optional(), insideArea: z.boolean(),
  eligibility: z.enum(["eligible", "conditional"]),
  priceStatus: z.enum(["known_within", "known_over", "unknown", "not_requested"]),
  hoursStatus: z.enum(["known_open", "known_closed", "unknown", "event_required"]),
  connections: z.array(PlaceConnection), limitations: z.array(z.string()), evidenceIds: z.array(Id),
});
export type VenueEvidence = z.infer<typeof VenueEvidence>;
export const AreaDecision = z.object({
  area: AreaIdentity, metrics: AreaMetrics, recommendationStatus: z.enum(["recommended", "needs_checking"]),
  headline: z.string(), tradeoff: z.string(), anchors: z.array(VenueEvidence), evidenceIds: z.array(Id),
});
export type AreaDecision = z.infer<typeof AreaDecision>;
export const Claim = z.object({ text: z.string(), evidenceIds: z.array(Id) });
export type Claim = z.infer<typeof Claim>;
export const HomeMatchV2 = z.object({
  area: AreaDecision,
  similarity: z.object({ value: z.number().min(0).max(100).nullable(), method: z.enum(["style_music_v1", "style_only_v1"]), referenceVersion: Id, support: Quality }),
  orderReason: z.enum(["home_similarity", "home_personal_blend"]), blendedRank: z.number().int().positive().optional(),
  sharedFeatures: z.array(z.object({ tagId: Id, label: z.string(), evidenceIds: z.array(Id) })),
  counterparts: z.array(z.object({ sourcePlaceId: Id, target: VenueEvidence })),
});
export type HomeMatchV2 = z.infer<typeof HomeMatchV2>;
export const AuditV2 = z.object({
  hardViolations: z.array(z.object({ constraintId: Id, placeId: Id.optional(), reason: z.string() })),
  unmet: z.array(z.object({ goalId: Id, reason: z.string(), recoverable: z.boolean() })), warnings: z.array(z.string()),
});
export type AuditV2 = z.infer<typeof AuditV2>;
export const AddressResultV2 = z.object({
  label: z.string(), point: LonLat, geocodeQuality: z.enum(["building", "street", "area"]), area: AreaDecision.nullable(),
  outsideSelectedArea: z.boolean(), nearby: z.array(z.object({ venue: VenueEvidence, walkMinutes: z.number().nonnegative(), approximate: z.literal(true) })),
  constraintsAudit: AuditV2, evidenceIds: z.array(Id),
});
export type AddressResultV2 = z.infer<typeof AddressResultV2>;
export const CityComparisonV2 = z.object({
  criteria: z.array(z.string()), referenceVersion: Id,
  method: z.enum(["home_style_music_v1", "home_style_only_v1", "personal_tags_v1"]).optional(),
  results: z.array(z.object({
    cityId: Id, cityName: z.string(), status: z.enum(["ok", "partial", "error"]),
    error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).optional(),
    areas: z.array(AreaDecision), homeMatches: z.array(HomeMatchV2).optional(), culturalOverlap: z.number().min(0).max(100).nullable(),
    eligibleCategories: z.array(z.string()), support: Quality, evidenceIds: z.array(Id),
  })), recommendation: z.object({ cityId: Id, claims: z.array(Claim) }).nullable(),
});
export type CityComparisonV2 = z.infer<typeof CityComparisonV2>;
export const VisitResultV2 = z.object({
  itinerary: Itinerary, constraints: z.array(Constraint), venueEvidence: z.record(z.string(), VenueEvidence), audit: AuditV2,
  recoveryLog: z.array(z.object({
    reason: z.string(), action: z.enum(["alternate_venue", "wider_radius", "alternate_area", "fewer_stops"]),
    affectedGoalIds: z.array(Id), changedStopIds: z.array(Id),
  })), evidenceIds: z.array(Id),
});
export type VisitResultV2 = z.infer<typeof VisitResultV2>;
export const AblationV2 = z.object({
  areaId: Id, loveId: Id, baseRank: z.number().int().positive(), withoutRank: z.number().int().positive().nullable(),
  deltaTasteScore: z.number(),
  // True means the rank changed AND the score gap exceeds the 0.01 tie band.
  // This is a meaningful move outside a tie, not a reason to label the result stable.
  tieChanged: z.boolean(),
});
export type AblationV2 = z.infer<typeof AblationV2>;
export const SourceAreaV2 = z.object({
  city: z.string().trim().min(1).max(80), neighborhood: z.string().trim().min(1).max(80),
  cityId: Id.optional(), areaId: Id.optional(), point: LonLat.optional(),
});
export type SourceAreaV2 = z.infer<typeof SourceAreaV2>;
export const SourceSignatureSummary = z.object({
  area: AreaIdentity, cityId: Id, cityName: z.string(), referenceVersion: Id,
  method: z.enum(["style_music_v1", "style_only_v1"]), support: Quality,
  venueCount: z.number().int().nonnegative(), categoryCounts: z.record(z.string(), z.number().int().nonnegative()),
  missingFamilies: z.array(z.string()), representatives: z.array(VenueEvidence),
  features: z.array(z.object({ tagId: Id, label: z.string(), family: z.enum(["placeStyle", "musicTaste"]), weight: Unit })),
  evidenceIds: z.array(Id),
});
export type SourceSignatureSummary = z.infer<typeof SourceSignatureSummary>;
export const TasteFieldV2 = TasteField.extend({
  cells: z.array(TasteField.shape.cells.element.extend({
    /** Native geohash-7, no early aggregation. Missing observations are not dislikes. */
    support: Unit, partnerSupport: Unit.optional(), signalKind: z.enum(["affinity_rank", "affinity", "mixed", "heuristic"]),
  })),
});
export type TasteFieldV2 = z.infer<typeof TasteFieldV2>;

// Shared request envelope: responseVersion is explicit for callers, defaulted for adapters.
export const AnalysisRequestV2 = z.object({
  responseVersion: z.literal(2).default(2), state: ExploreState, stateRevision: z.number().int().nonnegative(),
  manifestVersion: Id.optional(), constraints: z.array(Constraint).max(40).default([]),
});
export type AnalysisRequestV2 = z.infer<typeof AnalysisRequestV2>;
export const FieldRequestV2 = AnalysisRequestV2;
export const NeighborhoodsRequestV2 = AnalysisRequestV2;
export const FieldResponseV2 = z.object({ meta: ResultMeta, field: TasteFieldV2, support: Support });
export type FieldResponseV2 = z.infer<typeof FieldResponseV2>;
export const NeighborhoodsResponseV2 = z.object({ meta: ResultMeta, areas: z.array(AreaDecision), allCandidateIds: z.array(Id), evidence: z.array(EvidenceRef) });
export type NeighborhoodsResponseV2 = z.infer<typeof NeighborhoodsResponseV2>;
export const HomeRequestV2 = AnalysisRequestV2.extend({ source: SourceAreaV2, lambda: z.number().min(0).max(0.5).default(0) });
export type HomeRequestV2 = z.infer<typeof HomeRequestV2>;
export const HomeResponseV2 = z.object({ meta: ResultMeta, sourceSignatureSummary: SourceSignatureSummary, matches: z.array(HomeMatchV2), field: TasteFieldV2.optional(), evidence: z.array(EvidenceRef) });
export type HomeResponseV2 = z.infer<typeof HomeResponseV2>;
export const PlaceIntentV2 = z.enum(["coffee", "food", "bar", "dance", "concert", "live_music", "culture", "daily_life"]);
export type PlaceIntentV2 = z.infer<typeof PlaceIntentV2>;
export const PlacesRequestV2 = AnalysisRequestV2.extend({
  areaId: Id.optional(), intent: PlaceIntentV2.default("daily_life"), excludeIds: z.array(Id).max(100).default([]),
  temporaryTagIds: z.array(z.string().startsWith("urn:tag:")).max(8).default([]), radiusM: z.number().min(100).max(15000).optional(),
});
export type PlacesRequestV2 = z.infer<typeof PlacesRequestV2>;
export const PlacesResponseV2 = z.object({ meta: ResultMeta, venues: z.array(VenueEvidence), rejectedByReason: z.record(z.string(), z.number().int().nonnegative()), unmet: z.array(z.string()), evidence: z.array(EvidenceRef) });
export type PlacesResponseV2 = z.infer<typeof PlacesResponseV2>;
export const SpotRequestV2 = AnalysisRequestV2.extend({ query: z.string().trim().min(2).max(160).optional(), point: LonLat.optional(), analysisId: Id.optional(), areaId: Id.optional() }).refine(v => v.query || v.point, { message: "query or point is required" });
export type SpotRequestV2 = z.infer<typeof SpotRequestV2>;
export const SpotResponseV2 = AddressResultV2.extend({ meta: ResultMeta, evidence: z.array(EvidenceRef) });
export type SpotResponseV2 = z.infer<typeof SpotResponseV2>;
export const DecidesRequestV2 = AnalysisRequestV2.extend({ analysisId: Id.optional(), areaId: Id.optional() });
export type DecidesRequestV2 = z.infer<typeof DecidesRequestV2>;
export const DecidesResponseV2 = z.object({ meta: ResultMeta, baseOrder: z.array(Id), ablations: z.array(AblationV2), claims: z.array(Claim), evidence: z.array(EvidenceRef) });
export type DecidesResponseV2 = z.infer<typeof DecidesResponseV2>;
export const CitiesRequestV2 = AnalysisRequestV2.extend({ cities: z.array(z.string().trim().min(1).max(80)).min(1).max(5), source: SourceAreaV2.optional(), criteria: z.array(z.string().max(80)).max(8).default([]) });
export type CitiesRequestV2 = z.infer<typeof CitiesRequestV2>;
export const CitiesResponseV2 = CityComparisonV2.extend({ meta: ResultMeta, evidence: z.array(EvidenceRef) });
export type CitiesResponseV2 = z.infer<typeof CitiesResponseV2>;
export const PlanRequestV2 = AnalysisRequestV2.extend({
  areaIds: z.array(Id).min(1).max(3), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** A visit may start in the afternoon without changing the legacy morning preference. */
  startHour: z.number().int().min(6).max(22).optional(),
  includeIds: z.array(Id).max(24).default([]), excludeIds: z.array(Id).max(100).default([]), existingPlanId: Id.optional(),
  /** Prior itinerary is revalidated; unchanged eligible stops keep their IDs during a swap. */
  existingItinerary: Itinerary.optional(), replacePlaceId: Id.optional(),
});
export type PlanRequestV2 = z.infer<typeof PlanRequestV2>;
export const PlanResponseV2 = VisitResultV2.extend({ meta: ResultMeta, evidence: z.array(EvidenceRef) });
export type PlanResponseV2 = z.infer<typeof PlanResponseV2>;
export const SearchResponseV2 = z.object({ results: z.array(EntityRef), resolution: z.enum(["exact", "ambiguous", "no_match"]) });
export type SearchResponseV2 = z.infer<typeof SearchResponseV2>;
export const LocalityV2 = z.object({ cityId: Id, name: z.string(), country: z.string(), center: LonLat, source: z.string() });
export type LocalityV2 = z.infer<typeof LocalityV2>;
export const LocalitiesResponseV2 = z.object({ results: z.array(LocalityV2) });

export const GoalState = z.object({
  id: Id, kind: z.enum(["choose_area", "compare_cities", "evaluate_address", "find_venues", "build_visit"]),
  status: z.enum(["pending", "running", "satisfied", "partial", "failed", "needs_input"]), resultIds: z.array(Id), unmet: z.array(z.string()),
});
export type GoalState = z.infer<typeof GoalState>;
export const SessionMemory = z.object({
  revision: z.number().int().nonnegative(), constraints: z.array(Constraint).max(40),
  sourceHome: z.object({ cityId: Id, cityName: z.string().max(80).optional(), areaId: Id.optional(), name: z.string().max(160), point: LonLat.optional() }).optional(),
  lastAddress: z.object({ label: z.string().max(240), point: LonLat, cityId: Id, areaId: Id.optional(), resultId: Id }).optional(),
  selectedAreaIds: z.array(Id).max(24), rejectedPlaceIds: z.array(Id).max(100), savedPlaceIds: z.array(Id).max(100),
  lastResults: z.array(z.object({ id: Id, kind: z.string().max(40), profileHash: Id })).max(40),
});
export type SessionMemory = z.infer<typeof SessionMemory>;
export function toolOutcomeSchema<T extends z.ZodType>(data: T) {
  return z.object({
    id: Id, status: z.enum(["ok", "partial", "failed"]), data: data.optional(), evidence: z.array(EvidenceRef), satisfiedGoalIds: z.array(Id),
    unmet: AuditV2.shape.unmet, error: z.object({ code: z.string(), retryable: z.boolean(), message: z.string() }).optional(),
    cost: z.object({ qlooCacheMissCharges: z.number().int().nonnegative(), elapsedMs: z.number().nonnegative() }),
  });
}
export type ToolOutcome<T> = { id: string; status: "ok" | "partial" | "failed"; data?: T; evidence: EvidenceRef[]; satisfiedGoalIds: string[]; unmet: AuditV2["unmet"]; error?: { code: string; retryable: boolean; message: string }; cost: { qlooCacheMissCharges: number; elapsedMs: number } };
export const AgentCardV2 = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("areas"), areas: z.array(AreaDecision) }),
  z.object({ kind: z.literal("home"), matches: z.array(HomeMatchV2), sourceSignatureSummary: SourceSignatureSummary.optional() }),
  z.object({ kind: z.literal("address"), result: AddressResultV2 }),
  z.object({ kind: z.literal("venues"), venues: z.array(VenueEvidence) }),
  z.object({ kind: z.literal("comparison"), result: CityComparisonV2 }),
  z.object({ kind: z.literal("explanation"), claims: z.array(Claim), ablations: z.array(AblationV2) }),
  z.object({ kind: z.literal("visit"), result: VisitResultV2 }),
]);
export type AgentCardV2 = z.infer<typeof AgentCardV2>;
export const AgentRequestV2 = z.object({
  responseVersion: z.literal(2), sessionId: Id, turnId: Id, stateRevision: z.number().int().nonnegative(), state: ExploreState,
  memory: SessionMemory, message: z.string().trim().min(1).max(2000), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(6000) })).max(30).default([]),
  retryGoalId: Id.optional(),
});
export type AgentRequestV2 = z.infer<typeof AgentRequestV2>;
export const AgentEventV2 = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ack"), turnId: Id, text: z.string() }),
  z.object({ type: z.literal("plan"), turnId: Id, goals: z.array(GoalState), steps: z.array(z.string()) }),
  z.object({ type: z.literal("step"), turnId: Id, stepId: Id, status: z.enum(["running", "done", "failed"]), text: z.string() }),
  z.object({ type: z.literal("observation"), turnId: Id, goalId: Id, text: z.string(), evidenceIds: z.array(Id) }),
  z.object({ type: z.literal("replan"), turnId: Id, reason: z.string(), nextAction: z.string() }),
  z.object({ type: z.literal("patch"), turnId: Id, baseRevision: z.number().int().nonnegative(), nextRevision: z.number().int().nonnegative(), ops: z.array(StatePatch), constraints: z.array(Constraint).max(40).optional() }),
  z.object({ type: z.literal("result"), turnId: Id, meta: ResultMeta, card: AgentCardV2 }),
  z.object({ type: z.literal("answer"), turnId: Id, claims: z.array(Claim) }),
  z.object({ type: z.literal("error"), turnId: Id, goalId: Id.optional(), retryable: z.boolean(), message: z.string() }),
  z.object({ type: z.literal("done"), turnId: Id, goals: z.array(GoalState), memory: SessionMemory }),
]);
export type AgentEventV2 = z.infer<typeof AgentEventV2>;

export function emptySessionMemory(revision = 0): SessionMemory {
  return { revision, constraints: [], selectedAreaIds: [], rejectedPlaceIds: [], savedPlaceIds: [], lastResults: [] };
}
