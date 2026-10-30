// Feels like home, Check an address, Why this area and the city comparison over F0's v2 wrappers (api2).
// While a route still answers the stage-08 shape, the answer is adapted here into the v2 shape the screens
// render, carrying only facts the old answer really has (names, places, the order shown); adapted results
// have meta.methodVersion "legacy-adapter". Removed once every route answers v2.
import { api2 } from "@/components/explore/api";
import { areaFromNeighborhood, venueFromPlace } from "@/components/explore/adapt";
import type { CityScore, DecidesResult, ExploreState, HomeResult, Neighborhood, Place, SpotResult } from "@/shared/contracts";
import type {
  AreaDecision,
  CitiesResponseV2,
  Constraint,
  DecidesResponseV2,
  HomeResponseV2,
  ResultMeta,
  SourceAreaV2,
  SpotResponseV2,
  VenueEvidence,
  VenueRole,
} from "@/shared/contracts-09";

const now = () => new Date().toISOString();
function legacyMeta(state: ExploreState, stateRevision: number): ResultMeta {
  const t = now();
  return {
    responseVersion: 2,
    analysisId: `legacy-${t}`,
    profileHash: "legacy",
    stateRevision,
    cityId: state.city.trim().toLowerCase(),
    manifestVersion: "legacy",
    methodVersion: "legacy-adapter",
    generatedAt: t,
    dataAsOf: t,
    cache: "fresh",
    status: "complete",
  };
}
export const isLegacy = (meta?: ResultMeta | null) => !meta || meta.methodVersion === "legacy-adapter";

type HomePlace = HomeResult["source"]["places"][number];
const ROLE: Record<Place["category"], VenueRole> = { coffee: "coffee", food: "food", drinks: "bar", culture: "culture", stay: "culture" };
function homePlaceVenue(p: HomePlace, center: [number, number]): VenueEvidence {
  const place: Place = { id: p.id, name: p.name, category: p.category ?? "culture", lat: center[1], lon: center[0], affinity: 0, popularity: 0, why: p.tags, mapsUrl: "" };
  return { ...venueFromPlace(place), role: p.category ? ROLE[p.category] : "culture" };
}
const pseudoHood = (id: string, name: string, center: [number, number], rank: number): Neighborhood => ({
  id,
  name,
  center,
  rank,
  score: 0,
  you: 0,
  drivers: [],
  matchedTags: [],
  vibe: "mixed",
  samplePlaces: [],
  cellIds: [],
});
const withRank = (a: AreaDecision, rank: number, count: number): AreaDecision => ({ ...a, metrics: { ...a.metrics, rank, candidateCount: Math.max(count, rank) } });

export function homeFromLegacy(r: HomeResult, state: ExploreState, rev: number, lambda: number): HomeResponseV2 {
  const byId = new Map(r.neighborhoods.map((n) => [n.id, n]));
  // the old answer ordered by the heat map and showed tag overlap; without blending, order by the number shown
  const ms = r.matches.filter((m) => byId.has(m.neighborhoodId));
  if (lambda <= 0) ms.sort((a, b) => b.similarity - a.similarity);
  return {
    meta: legacyMeta(state, rev),
    sourceSignatureSummary: {
      area: { id: `src-${r.source.neighborhood}`, name: r.source.neighborhood, aliases: [], center: r.source.center, geometry: { kind: "circle", radiusM: 1200 }, geometryQuality: "approximate" },
      cityId: r.source.city.toLowerCase(),
      cityName: r.source.city,
      referenceVersion: "legacy",
      method: "style_only_v1",
      support: r.source.places.length >= 8 ? "sufficient" : "limited",
      venueCount: r.source.places.length,
      categoryCounts: r.source.places.reduce<Record<string, number>>((acc, p) => ((acc[p.category ?? "other"] = (acc[p.category ?? "other"] ?? 0) + 1), acc), {}),
      missingFamilies: ["musicTaste"],
      representatives: r.source.places.map((p) => homePlaceVenue(p, r.source.center)),
      features: r.source.tags.map((t) => ({ tagId: t, label: t, family: "placeStyle" as const, weight: 0 })),
      evidenceIds: [],
    },
    matches: ms.map((m, i) => {
      const n = byId.get(m.neighborhoodId)!;
      return {
        area: withRank(areaFromNeighborhood(n, r.neighborhoods), i + 1, r.neighborhoods.length),
        similarity: { value: m.similarity, method: "style_only_v1" as const, referenceVersion: "legacy", support: "sufficient" as const },
        orderReason: lambda > 0 ? ("home_personal_blend" as const) : ("home_similarity" as const),
        sharedFeatures: m.sharedTags.map((t) => ({ tagId: t, label: t, evidenceIds: [] })),
        counterparts: m.twins.map((t) => ({ sourcePlaceId: t.source.id, target: homePlaceVenue(t.target, n.center) })),
      };
    }),
    evidence: [],
  };
}

export function spotFromLegacy(r: SpotResult, state: ExploreState, rev: number): SpotResponseV2 {
  const flags = r as SpotResult & { streetLevel?: boolean; precision?: string };
  const street = flags.streetLevel === true || flags.precision === "street" || /house number not found/i.test(r.verdict);
  const nb = r.neighborhood;
  return {
    meta: legacyMeta(state, rev),
    label: r.label,
    point: r.point,
    geocodeQuality: street ? "street" : "building",
    area: nb ? areaFromNeighborhood(pseudoHood(nb.id, nb.name, r.point, nb.rank), []) : null,
    outsideSelectedArea: !!state.neighborhood && !!nb && nb.id !== state.neighborhood,
    nearby: r.walk.map((w) => ({ venue: venueFromPlace(w.place), walkMinutes: w.minutes, approximate: true as const })),
    constraintsAudit: { hardViolations: [], unmet: [], warnings: [] },
    evidenceIds: [],
    evidence: [],
  };
}

export function decidesFromLegacy(r: DecidesResult, state: ExploreState, rev: number): DecidesResponseV2 {
  const idOf = (q: string) => state.loves.find((l) => l.query === q)?.chosen?.id ?? q;
  return {
    meta: legacyMeta(state, rev),
    baseOrder: r.neighborhoods.map((n) => n.id),
    ablations: r.neighborhoods.flatMap((n) => n.without.map((w) => ({ areaId: n.id, loveId: idOf(w.query), baseRank: n.rank, withoutRank: w.rank, deltaTasteScore: 0, tieChanged: false }))),
    claims: [],
    evidence: [],
  };
}

export function citiesFromLegacy(list: CityScore[], state: ExploreState, rev: number): CitiesResponseV2 {
  return {
    meta: legacyMeta(state, rev),
    criteria: ["everyday_venues", "support"],
    referenceVersion: "legacy",
    results: list.map((c) => ({
      cityId: c.city.toLowerCase(),
      cityName: c.city,
      status: c.error ? ("error" as const) : ("ok" as const),
      ...(c.error ? { error: { code: "not_found", message: c.error, retryable: false } } : {}),
      areas: c.topNeighborhood ? [areaFromNeighborhood(pseudoHood(`${c.city}-${c.topNeighborhood}`, c.topNeighborhood, c.center, 1), [])] : [],
      culturalOverlap: null,
      eligibleCategories: [...new Set(c.topPlaces.map((p) => p.category))],
      support: c.sparse ? ("limited" as const) : ("sufficient" as const),
      evidenceIds: [],
    })),
    recommendation: null,
    evidence: [],
  };
}

export const api09 = {
  home: (state: ExploreState, rev: number, source: SourceAreaV2, lambda: number, constraints: Constraint[] = [], signal?: AbortSignal): Promise<HomeResponseV2> =>
    api2.home(state, { stateRevision: rev, constraints, source, lambda }, signal).then((r) => (r.v === 2 ? r.data : homeFromLegacy(r.data, state, rev, lambda))),
  spot: (state: ExploreState, rev: number, where: { query?: string; point?: [number, number]; analysisId?: string; areaId?: string }, constraints: Constraint[] = [], signal?: AbortSignal): Promise<SpotResponseV2> =>
    api2.spot(state, { stateRevision: rev, constraints, ...where }, signal).then((r) => (r.v === 2 ? r.data : spotFromLegacy(r.data, state, rev))),
  decides: (state: ExploreState, rev: number, opts: { analysisId?: string; areaId?: string } = {}, constraints: Constraint[] = [], signal?: AbortSignal): Promise<DecidesResponseV2> =>
    api2.decides(state, { stateRevision: rev, constraints, ...opts }, signal).then((r) => (r.v === 2 ? r.data : decidesFromLegacy(r.data, state, rev))),
  cities: (state: ExploreState, rev: number, cities: string[], source: SourceAreaV2 | undefined, criteria: string[], constraints: Constraint[] = [], signal?: AbortSignal): Promise<CitiesResponseV2> =>
    api2.cities(state, { stateRevision: rev, constraints, cities, ...(source ? { source } : {}), criteria }, signal).then((r) => (r.v === 2 ? r.data : citiesFromLegacy(r.data.cities, state, rev))),
};
