import type { AreaIdentity, PlaceV2, Support } from "@/shared/contracts-09";
import { haversine, mean, median, percentileRanks } from "../geo";
import { encodeGeohash, geohashBounds } from "./geometry";

export const CONTEXT_RADIUS_M = 1600;
export type ContextCell = { h: string; center: [number, number]; areaM2: number };
export type CoarseSignalCell = { h: string; affinity: number; popularity: number };
export type ContextSignal = {
  query: string; weight: number; status: "ok" | "no_signal" | "unavailable";
  contextCells?: CoarseSignalCell[]; contextRanks?: Map<string, number>;
};

/** Fixed coarse-cell locations and assignment, built only from the neutral catalog.
 * Neutral venue centroids locate the occupied part of a coarse cell. Empty catalog
 * cells use their geometric center. No taste response can move or rename a cell.
 * The 650 m circle remains the area for anchor/visit evidence; the wider context
 * supports district-scale exploration and is exposed separately in AreaMetrics.
 */
export function fixedContexts(areas: AreaIdentity[], catalog: PlaceV2[], center: [number, number], radiusM: number): { areas: Map<string, ContextCell[]>; grid: ContextCell[] } {
  const result = new Map(areas.map(area => [area.id, [] as ContextCell[]]));
  const grid: ContextCell[] = [];
  const places = new Map<string, PlaceV2[]>();
  for (const place of [...catalog].sort((a, b) => a.id.localeCompare(b.id))) {
    const h = encodeGeohash([place.lon, place.lat], 6), group = places.get(h) ?? [];
    group.push(place); places.set(h, group);
  }
  const latStep = 180 / 2 ** 15, lonStep = 360 / 2 ** 15;
  const latRadius = radiusM / 111195, lonRadius = latRadius / Math.cos(center[1] * Math.PI / 180);
  const minY = Math.floor((center[1] - latRadius + 90) / latStep), maxY = Math.floor((center[1] + latRadius + 90) / latStep);
  const minX = Math.floor((center[0] - lonRadius + 180) / lonStep), maxX = Math.floor((center[0] + lonRadius + 180) / lonStep);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const geometric: [number, number] = [x * lonStep - 180 + lonStep / 2, y * latStep - 90 + latStep / 2];
    const h = encodeGeohash(geometric, 6), local = places.get(h) ?? [];
    const point: [number, number] = local.length ? [mean(local.map(p => p.lon)), mean(local.map(p => p.lat))] : geometric;
    if (haversine(center, point) > radiusM) continue;
    const bounds = geohashBounds(h)!;
    const areaM2 = 6371000 ** 2 * (lonStep * Math.PI / 180) * (Math.sin(bounds[3] * Math.PI / 180) - Math.sin(bounds[1] * Math.PI / 180));
    const cell = { h, center: point, areaM2 }; grid.push(cell);
    const nearest = areas.map(area => ({ id: area.id, distance: haversine(point, area.center) }))
      .filter(area => area.distance <= CONTEXT_RADIUS_M).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))[0];
    if (!nearest) continue;
    result.get(nearest.id)!.push(cell);
  }
  for (const cells of result.values()) cells.sort((a, b) => a.h.localeCompare(b.h));
  return { areas: result, grid: grid.sort((a, b) => a.h.localeCompare(b.h)) };
}

/** Stage-08 stabilized per-love signal. This is a heuristic, not population correction. */
export function coarseSignalRanks(cells: CoarseSignalCell[]): Map<string, number> {
  const observed = [...new Map(cells.filter(c => c.affinity > 0).map(c => [c.h, c])).values()].sort((a, b) => a.h.localeCompare(b.h));
  const prior = Math.max(.02, median(observed.map(c => c.popularity)));
  const ranks = percentileRanks(observed.map(c => (c.affinity + prior) / (c.popularity + prior)));
  return new Map(observed.map((cell, i) => [cell.h, ranks[i]]));
}

export function scoreContext(cells: ContextCell[], signals: ContextSignal[], discovery: number): { score: number; support: Support } {
  const usable = signals.filter(s => s.status === "ok" && s.weight > 0 && s.contextRanks?.size);
  const weight = usable.reduce((sum, s) => sum + s.weight, 0), allWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const popularity = usable.map(signal => new Map(signal.contextCells?.map(c => [c.h, c.popularity]) ?? []));
  const local = cells.filter(cell => usable.some(signal => signal.contextRanks!.has(cell.h)));
  const surveyedArea = cells.reduce((sum, c) => sum + c.areaM2, 0), observedArea = local.reduce((sum, c) => sum + c.areaM2, 0);
  const coveredWeight = usable.filter(signal => local.some(c => signal.contextRanks!.has(c.h))).reduce((sum, s) => sum + s.weight, 0);
  const reliability = local.length / (local.length + 3);
  const score = observedArea && weight ? local.reduce((sum, cell) => {
    // Absent love/cell pairs contribute no evidence. They are never labeled as
    // dislikes; the separate support fields retain the missing-data limitation.
    const raw = usable.reduce((value, signal) => value + signal.weight * (signal.contextRanks!.get(cell.h) ?? 0), 0) / weight;
    const observed = usable.flatMap((signal, i) => popularity[i].has(cell.h) ? [{ weight: signal.weight, value: popularity[i].get(cell.h)! }] : []);
    const observedWeight = observed.reduce((value, item) => value + item.weight, 0);
    const popular = observedWeight ? observed.reduce((value, item) => value + item.weight * item.value, 0) / observedWeight : 0;
    return sum + cell.areaM2 * (.5 + reliability * (raw - .5)) * (1 - .7 * discovery * popular);
  }, 0) / observedArea : 0;
  const activeLoveWeightCovered = allWeight ? coveredWeight / allWeight : 0, observedAreaShare = surveyedArea ? observedArea / surveyedArea : 0;
  const quality = !usable.length ? "unavailable" : activeLoveWeightCovered >= .5 && local.length >= 3 && observedAreaShare >= .25 ? "sufficient" : "limited";
  return { score, support: { quality, activeLoveWeightCovered, observedAreaShare, spatialBlocks: local.length, eligibleVenueCount: 0, categoryCount: 0,
    missingSignals: signals.filter(s => s.status !== "ok").map(s => ({ query: s.query, reason: s.status as "no_signal" | "unavailable" })),
    notes: ["Ranking uses fixed context cells assigned within 1.6 km of the area center. Venue checks use its 650 m circle.",
      "Missing love-cell pairs contribute no evidence to this exploratory index; they do not establish a dislike.",
      ...(quality === "sufficient" ? [] : [`Only ${local.length} context cells have observations here; compare the actual places before choosing.`])] } };
}
