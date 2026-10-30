// Owner: F0. Temporary bridges between stage-08 payloads and the stage-09 shapes the UI is written against.
// A legacy answer is adapted only into neutral facts it really carries (rank among the areas returned, names,
// places); it never invents support, percentiles, evidence or audits. Removed once every route answers v2.

import type { Category, Itinerary, Neighborhood, Place } from "@/shared/contracts";
import type { AreaDecision, Constraint, Support, VenueEvidence, VenueRole, VisitResultV2 } from "@/shared/contracts-09";

/** A support block for a legacy ranking: no measure exists, so nothing is claimed beyond the area count. */
const legacySupport = (): Support => ({
  quality: "sufficient",
  activeLoveWeightCovered: 0,
  observedAreaShare: 0,
  spatialBlocks: 0,
  eligibleVenueCount: 0,
  categoryCount: 0,
  missingSignals: [],
  notes: ["legacy ranking without a support measure"],
});

export function areaFromNeighborhood(n: Neighborhood, all: Neighborhood[]): AreaDecision {
  return {
    area: { id: n.id, name: n.name, aliases: [], center: n.center, geometry: { kind: "circle", radiusM: 650 }, geometryQuality: "approximate" },
    metrics: {
      tasteScore: Math.max(0, Math.min(1, n.score)),
      rank: n.rank,
      candidateCount: Math.max(all.length, n.rank),
      percentile: null,
      tieBand: false,
      support: legacySupport(),
    },
    recommendationStatus: "needs_checking",
    headline: "",
    tradeoff: "",
    anchors: [],
    evidenceIds: [],
  };
}

/** The map and older panels still draw `Neighborhood` plates; a v2 area gives them what they need. */
export function neighborhoodFromArea(a: AreaDecision): Neighborhood {
  const m = a.metrics;
  return {
    id: a.area.id,
    name: a.area.name,
    center: a.area.center,
    score: m.tasteScore,
    you: m.you?.score ?? m.tasteScore,
    ...(m.partner ? { them: m.partner.score } : {}),
    rank: m.rank,
    drivers: [],
    matchedTags: [],
    vibe: "mixed",
    samplePlaces: a.anchors.slice(0, 3).map((v) => v.place.name),
    cellIds: [],
  };
}

const ROLE_OF: Record<Category, VenueRole> = { coffee: "coffee", food: "food", drinks: "bar", culture: "culture", stay: "culture" };

/** A legacy place shown where v2 venue evidence is expected: no connections, no audit claims. */
export function venueFromPlace(p: Place): VenueEvidence {
  return {
    place: p,
    role: ROLE_OF[p.category],
    venueKey: p.id,
    insideArea: true,
    eligibility: "conditional",
    priceStatus: "not_requested",
    hoursStatus: "unknown",
    connections: [],
    limitations: [],
    evidenceIds: [],
  };
}

/** A legacy itinerary in the visit shape, with an empty audit (nothing was checked, nothing is claimed). */
export function visitFromItinerary(itinerary: Itinerary, constraints: Constraint[]): VisitResultV2 {
  const venueEvidence: Record<string, VenueEvidence> = {};
  for (const d of itinerary.days) for (const s of d.stops) venueEvidence[s.place.id] = venueFromPlace(s.place);
  return {
    itinerary,
    constraints,
    venueEvidence,
    audit: { hardViolations: [], unmet: [], warnings: ["This plan was built by the older planner; its constraints were not audited."] },
    recoveryLog: [],
    evidenceIds: [],
  };
}

const CATEGORY_WORDS: Record<string, Category> = {
  bar: "drinks", bars: "drinks", drinks: "drinks", pub: "drinks", nightlife: "drinks",
  cafe: "coffee", "café": "coffee", cafes: "coffee", coffee: "coffee",
  restaurant: "food", restaurants: "food", food: "food",
  hotel: "stay", hotels: "stay", stay: "stay",
  culture: "culture",
};

/** Constraints in the legacy planner's words: whole categories, tag exclusions and a price ceiling. */
export function legacyRules(constraints: Constraint[]): { excludeCategories: Category[]; excludeTags: string[]; budget: number | null } {
  const excludeCategories = new Set<Category>();
  const excludeTags = new Set<string>();
  let budget: number | null = null;
  for (const c of constraints) {
    if (c.kind === "exclude_type" && typeof c.value === "string") {
      const cat = CATEGORY_WORDS[c.value.trim().toLowerCase()];
      if (cat) excludeCategories.add(cat);
      else excludeTags.add(c.value.trim().toLowerCase());
    } else if (c.kind === "budget" && typeof c.value === "number" && c.strength === "hard") {
      const v = Math.max(1, Math.min(4, Math.round(c.value)));
      budget = budget === null ? v : Math.min(budget, v);
    }
  }
  return { excludeCategories: [...excludeCategories], excludeTags: [...excludeTags], budget };
}
