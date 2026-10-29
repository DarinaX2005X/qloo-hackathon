import { z } from "zod";

/** Entity domains Homing understands. Mirrors Qloo `urn:entity:<domain>`. */
export const DOMAINS = [
  "artist",
  "movie",
  "tv_show",
  "book",
  "author",
  "person",
  "brand",
  "place",
  "podcast",
  "video_game",
  "destination",
] as const;
export const Domain = z.enum(DOMAINS);
export type Domain = z.infer<typeof Domain>;

export const LIMITS = { loves: 8, refinements: 4, companionLoves: 8 } as const;

export const EntityRef = z.object({
  id: z.string(),
  name: z.string(),
  domain: Domain,
  image: z.string().optional(),
  subtitle: z.string().optional(),
  popularity: z.number().optional(),
  /** set when this entity stands in for a genre the person typed ("jazz" → Miles Davis) */
  via: z.string().max(60).optional(),
});
export type EntityRef = z.infer<typeof EntityRef>;

export const ResolvedLove = z.object({
  /** What the person typed, e.g. "radiohead". Stable key for patches. */
  query: z.string().min(1).max(120),
  chosen: EntityRef.nullable(),
  candidates: z.array(EntityRef).max(6),
  /** 0..1, default 1. */
  weight: z.number().min(0).max(1).default(1),
});
export type ResolvedLove = z.infer<typeof ResolvedLove>;

export const TagRef = z.object({
  id: z.string(),
  name: z.string(),
  /** Segment of the urn, e.g. "ambience" for urn:tag:ambience:qloo:cozy. */
  kind: z.string(),
});
export type TagRef = z.infer<typeof TagRef>;

export const ExploreState = z.object({
  city: z.string().min(1).max(80),
  loves: z.array(ResolvedLove).max(LIMITS.loves),
  refinements: z.array(TagRef).max(LIMITS.refinements).default([]),
  /** 0 = popular, 1 = local. */
  discovery: z.number().min(0).max(1).default(0.35),
  companion: z
    .object({ loves: z.array(ResolvedLove).max(LIMITS.companionLoves) })
    .nullable()
    .optional(),
  neighborhood: z.string().nullable().optional(),
  days: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  /** max price level for places, 1 = $ … 4 = $$$$; null = any */
  budget: z.number().int().min(1).max(4).nullable().optional(),
  /** how many stops a day: relaxed 4, balanced 6, packed 8 */
  pace: z.enum(["relaxed", "balanced", "packed"]).default("balanced"),
  /** first stop of the day, local hour */
  startHour: z.number().int().min(6).max(12).default(9),
});
export type ExploreState = z.infer<typeof ExploreState>;

export const FieldCell = z.object({
  /** geohash-6 key */
  h: z.string(),
  lat: z.number(),
  lon: z.number(),
  /** 0..1 final score for the person, after weights, refinements, discovery. */
  you: z.number(),
  them: z.number().optional(),
  /** min(you, them) */
  both: z.number().optional(),
  /** 0..1 how popular the cell is overall (Qloo `popularity`). */
  popularity: z.number(),
  /** Share of the person's score coming from each domain, sums to ~1. */
  drivers: z.record(z.string(), z.number()),
});
export type FieldCell = z.infer<typeof FieldCell>;

export const TasteField = z.object({
  city: z.string(),
  center: z.tuple([z.number(), z.number()]), // [lon, lat]
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), // [w, s, e, n]
  cells: z.array(FieldCell),
  sparse: z.boolean(),
  /** Queries of loves that have no geographic signal in Qloo (e.g. video games). */
  signalsWithoutGeo: z.array(z.string()),
});
export type TasteField = z.infer<typeof TasteField>;

export const Vibe = z.enum(["local", "mixed", "touristy"]);
export type Vibe = z.infer<typeof Vibe>;

export const Neighborhood = z.object({
  id: z.string(),
  name: z.string(),
  center: z.tuple([z.number(), z.number()]), // [lon, lat]
  /** 0..1 ranking score (for two people: fairness score). */
  score: z.number(),
  you: z.number(),
  them: z.number().optional(),
  rank: z.number().int().min(1),
  drivers: z.array(z.object({ domain: Domain, share: z.number(), love: z.string() })),
  matchedTags: z.array(z.string()),
  vibe: Vibe,
  samplePlaces: z.array(z.string()),
  cellIds: z.array(z.string()),
});
export type Neighborhood = z.infer<typeof Neighborhood>;

export const CATEGORIES = ["coffee", "food", "drinks", "culture", "stay"] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

export const OpeningSpan = z.object({ opens: z.string(), closes: z.string() });
export const Place = z.object({
  id: z.string(),
  name: z.string(),
  category: Category,
  lat: z.number(),
  lon: z.number(),
  affinity: z.number(),
  popularity: z.number(),
  address: z.string().optional(),
  image: z.string().optional(),
  /** keys: monday..sunday, values "HH:MM" */
  hours: z.record(z.string(), z.array(OpeningSpan)).optional(),
  priceLevel: z.number().optional(),
  why: z.array(z.string()),
  description: z.string().optional(),
  mapsUrl: z.string(),
  neighborhood: z.string().optional(),
  website: z.string().optional(),
  /** short descriptive keywords from Qloo, most mentioned first */
  keywords: z.array(z.string()).optional(),
});
export type Place = z.infer<typeof Place>;

export const Stop = z.object({
  time: z.string(), // "09:00"
  slot: z.string(), // "Morning coffee"
  place: Place,
  walkMin: z.number(),
  hoursNote: z.enum(["open", "hours not listed"]).optional(),
});
export type Stop = z.infer<typeof Stop>;

export const Itinerary = z.object({
  days: z.array(
    z.object({
      date: z.string().optional(), // ISO date
      weekday: z.string().optional(),
      neighborhood: z.string(),
      stops: z.array(Stop),
      missing: z.array(z.string()).default([]), // slots we could not fill
    }),
  ),
});
export type Itinerary = z.infer<typeof Itinerary>;

export const Fingerprint = z.object({
  you: z.array(TagRef),
  them: z.array(TagRef).optional(),
  shared: z.array(TagRef).optional(),
  onlyYou: z.array(TagRef).optional(),
  onlyThem: z.array(TagRef).optional(),
});
export type Fingerprint = z.infer<typeof Fingerprint>;

export const ErrorCode = z.enum([
  "not_found",
  "sparse_city",
  "qloo_unavailable",
  "quota",
  "bad_input",
  "llm_unavailable",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
export const ApiError = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), retryable: z.boolean() }),
});
export type ApiError = z.infer<typeof ApiError>;

export const StatePatch = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_city"), city: z.string().min(1).max(80) }),
  z.object({ op: z.literal("add_love"), love: ResolvedLove }),
  z.object({ op: z.literal("remove_love"), query: z.string() }),
  z.object({ op: z.literal("set_weight"), query: z.string(), weight: z.number().min(0).max(1) }),
  z.object({ op: z.literal("add_refinement"), tag: TagRef }),
  z.object({ op: z.literal("remove_refinement"), id: z.string() }),
  z.object({ op: z.literal("set_discovery"), value: z.number().min(0).max(1) }),
  z.object({ op: z.literal("set_companion"), loves: z.array(ResolvedLove).nullable() }),
  z.object({ op: z.literal("set_days"), days: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ op: z.literal("select_neighborhood"), id: z.string().nullable() }),
  z.object({ op: z.literal("set_budget"), budget: z.number().int().min(1).max(4).nullable() }),
  z.object({ op: z.literal("set_pace"), pace: z.enum(["relaxed", "balanced", "packed"]) }),
  z.object({ op: z.literal("set_start"), hour: z.number().int().min(6).max(12) }),
]);
export type StatePatch = z.infer<typeof StatePatch>;

// ---- Route payloads ----

export const SearchResponse = z.object({ results: z.array(EntityRef) });
export const TagSearchResponse = z.object({ results: z.array(TagRef) });

export const IntakeRequest = z
  .object({ text: z.string().max(2000).optional(), image: z.string().optional() })
  .refine((v) => !!v.text?.trim() || !!v.image, { message: "text or image required" });
export const IntakeResponse = z.object({ loves: z.array(ResolvedLove), city: z.string().optional() });

export const NeighborhoodsResponse = z.object({ neighborhoods: z.array(Neighborhood) });
export const PlacesRequest = ExploreState.extend({
  neighborhoodId: z.string(),
  categories: z.array(Category).optional(),
});
export const PlacesResponse = z.object({ places: z.array(Place) });
export const PlanRequest = ExploreState.extend({
  neighborhoodIds: z.array(z.string()).min(1).max(3),
  /** place ids the person removed or swapped out: never plan them */
  exclude: z.array(z.string()).max(60).default([]),
  /** place ids the person wants in the plan (from the shortlist); placed in fitting slots first */
  include: z.array(z.string()).max(12).default([]),
});

/** One city scored for the same taste, for the "where should I go" comparison. */
export const CityScore = z.object({
  city: z.string(),
  /** 0..1, comparable across cities: how strongly the city's places match this taste */
  score: z.number(),
  /** 0..1 share of the city's top places that match the taste well */
  depth: z.number(),
  center: z.tuple([z.number(), z.number()]),
  topNeighborhood: z.string().nullable(),
  topPlaces: z.array(z.object({ name: z.string(), category: Category, affinity: z.number() })).max(4),
  matchedTags: z.array(z.string()).max(4),
  sparse: z.boolean(),
  error: z.string().optional(),
});
export type CityScore = z.infer<typeof CityScore>;
export const CitiesRequest = z.object({ state: ExploreState, cities: z.array(z.string().min(1).max(80)).min(2).max(5) });
export const CitiesResponse = z.object({ cities: z.array(CityScore) });

export const AgentMessage = z.object({ role: z.enum(["user", "assistant"]), content: z.string() });
export const AgentRequest = z.object({
  state: ExploreState,
  message: z.string().min(1).max(1000),
  history: z.array(AgentMessage).max(20).default([]),
});
export type AgentRequest = z.infer<typeof AgentRequest>;

/** Server-sent events emitted by POST /api/agent, one JSON object per `data:` line. */
export type AgentEvent =
  | { type: "trace"; tool: string; summary: string }
  | { type: "patch"; ops: StatePatch[] }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; error: ApiError["error"] };

/** Loves that carry a resolved entity, i.e. usable as Qloo signals. */
export function activeLoves(loves: ResolvedLove[]) {
  return loves.filter((l) => l.chosen && l.weight > 0) as (ResolvedLove & { chosen: EntityRef })[];
}

export function apiError(code: ErrorCode, message: string, retryable = false): ApiError {
  return { error: { code, message, retryable } };
}
