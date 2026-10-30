import type { Neighborhood } from "@/shared/contracts";
import type { AreaDecision, VenueEvidence } from "@/shared/contracts-09";
import { legacyMetrics, type MetricInput, type Quality } from "@/lib/honest";

/**
 * One candidate area as the map and the shortlist draw it. Built from the v2 `AreaDecision` when the
 * backend sends one, otherwise from today's `Neighborhood` (rank only, no score). Nothing here formats a
 * score: numbers go through the shared metric renderer.
 */
export type MapArea = {
  id: string;
  name: string;
  center: [number, number];
  rank: number;
  /** walkable circle around the centre, metres; null when the geometry is unknown */
  radiusM?: number | null;
  /** the circle is an approximation, so labels say "Around Anjos" */
  approximate?: boolean;
};

export type AreaAnchor = {
  id: string;
  name: string;
  /** coffee, food, bar, dance, live_music, culture; empty for legacy sample places */
  role: string | null;
  lon?: number;
  lat?: number;
  insideArea: boolean;
  /** the full v2 evidence when the backend sent it */
  venue?: VenueEvidence;
};

export type ShortlistArea = MapArea & {
  /** "Around Anjos" for an approximate circle, the plain name otherwise */
  label: string;
  metrics: MetricInput;
  status: "recommended" | "needs_checking";
  /** one concrete reason this area is on the list for this person */
  headline: string | null;
  /** one short tradeoff or limit of the evidence */
  tradeoff: string | null;
  anchors: AreaAnchor[];
  /** the legacy record, while screens still read it */
  legacy?: Neighborhood;
  /** the v2 record */
  decision?: AreaDecision;
};

/** The v2 decision for one area (contracts-09). */
export type AreaDecisionLike = AreaDecision;

export const ROLE_LABEL: Record<string, string> = {
  coffee: "Café",
  food: "Food",
  bar: "Bar",
  dance: "Dancing",
  live_music: "Live music",
  culture: "Culture",
};

export const DEFAULT_RADIUS_M = 650;

const LODGING = /\b(hotel|hostel|suites?|apartments?|inn|resort|guest ?house|b&b|by hilton|marriott|ibis|novotel)\b/i;

export const areaLabel = (name: string, approximate?: boolean) => (approximate ? `Around ${name}` : name);

export function isDecision(x: unknown): x is AreaDecisionLike {
  return !!x && typeof x === "object" && "area" in x && "metrics" in x;
}

export function fromDecision(d: AreaDecisionLike): ShortlistArea {
  const approximate = d.area.geometryQuality !== "verified";
  return {
    id: d.area.id,
    name: d.area.name,
    label: areaLabel(d.area.name, approximate),
    center: d.area.center,
    rank: d.metrics.rank,
    radiusM: d.area.geometry.kind === "circle" ? d.area.geometry.radiusM : null,
    approximate,
    metrics: d.metrics,
    status: d.recommendationStatus,
    headline: d.headline?.trim() || null,
    tradeoff: d.tradeoff?.trim() || null,
    anchors: d.anchors.map((a) => ({ id: a.place.id, name: a.place.name, role: a.role, lon: a.place.lon, lat: a.place.lat, insideArea: a.insideArea, venue: a })),
    decision: d,
  };
}

/** A sentence from today's ranking that stays true: which love leads here, or that they land evenly. */
function legacyReason(n: Neighborhood): string | null {
  const top = n.drivers[0];
  if (top && top.share >= 0.36) return `${top.love} shows up most strongly around here.`;
  if (n.drivers.length > 1) return "Your loves show up here about evenly.";
  return null;
}

export function fromLegacy(n: Neighborhood, all?: readonly Neighborhood[] | null): ShortlistArea {
  return {
    id: n.id,
    name: n.name,
    label: n.name,
    center: n.center,
    rank: n.rank,
    radiusM: null,
    approximate: false,
    metrics: legacyMetrics(n, all),
    status: "recommended",
    headline: legacyReason(n),
    tradeoff: null,
    // the old sample list mixes in hotels; they are not everyday places, so they never stand as evidence
    anchors: n.samplePlaces.filter((p) => !LODGING.test(p)).slice(0, 2).map((name) => ({ id: `${n.id}:${name}`, name, role: null, insideArea: true })),
    legacy: n,
  };
}

/** Either shape in, one shape out, ordered by rank. */
export function toShortlist(list: readonly (Neighborhood | AreaDecisionLike)[] | null | undefined): ShortlistArea[] {
  if (!list?.length) return [];
  const legacy = list.filter((x): x is Neighborhood => !isDecision(x));
  return list.map((x) => (isDecision(x) ? fromDecision(x) : fromLegacy(x, legacy))).sort((a, b) => a.rank - b.rank);
}
