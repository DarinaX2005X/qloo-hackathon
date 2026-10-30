import { type ExploreState, type Neighborhood, type TasteField } from "@/shared/contracts";
import { record, string, unit, type QlooRecord } from "@/server/qloo/client";
import { buildField, loadLoveMaps, loveSeries, type LoveSeries } from "./field";
import { matchedPlaceTags } from "./fingerprint";
import { coordinates, focusRadius, haversine, mean, median } from "./geo";
import { getCityEvidence } from "./evidence";

export { coordinates } from "./geo";
export { cityPlaces } from "./evidence";

export function neighborhoodName(row: QlooRecord): string | undefined {
  const properties = record(row.properties);
  return string(properties.neighborhood) ?? string(record(properties.neighborhood).name) ?? string(record(properties.geocode).name);
}

export function neighborhoodId(city: string, name: string): string {
  return `${encodeURIComponent(city.trim().toLowerCase())}:${encodeURIComponent(name.trim().toLowerCase())}`;
}

export function normalizedAreaName(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function neighborhoodDrivers(series: LoveSeries[], cityCells: string[], areaCells: string[]): Neighborhood["drivers"] {
  const contributions = series.map((item) => {
    const local = mean(areaCells.map((h) => item.values.get(h) ?? 0));
    const baseline = median(cityCells.map((h) => item.values.get(h) ?? 0));
    return { love: item.love, affinity: item.love.weight * local, lift: item.love.weight * Math.max(0, local - baseline) };
  });
  const useLift = contributions.some((item) => item.lift > 1e-9);
  const values = contributions.map((item) => ({ ...item, value: useLift ? item.lift : item.affinity }));
  const total = values.reduce((sum, item) => sum + item.value, 0);
  return values.filter((item) => item.value > 0).map(({ love, value }) => ({
    domain: love.chosen.domain, love: love.chosen.name, share: value / total,
  })).sort((a, b) => b.share - a.share);
}

/** Three neutral cell-equivalents regularize small areas; this is not a confidence interval. */
export const NEUTRAL_CELL_PRIOR = 3;

export function areaMatchScore(cells: TasteField["cells"], discovery: number, person: "you" | "them" = "you"): number {
  const unique = [...new Map(cells.map(cell => [cell.h, cell])).values()];
  // A prior cannot manufacture support when this person has no mapped signal in the area.
  if (!unique.some(cell => (cell[person] ?? 0) > 0)) return 0;
  const reliability = unique.length / (unique.length + NEUTRAL_CELL_PRIOR);
  // cell[person] already includes weights, refinements and the crowd discount.
  // Shrink its underlying percentile toward .5, then apply that SAME discount to the prior.
  return mean(unique.map(cell => reliability * (cell[person] ?? 0)
    + (1 - reliability) * .5 * (1 - .7 * discovery * cell.popularity)));
}

/** Both score and displayed lift are the same adjusted match metric, on affine scales. */
export function orderNeighborhoods(areas: Neighborhood[]): Neighborhood[] {
  const ordered = areas.map(area => ({ ...area, lift: 2 * area.score - 1, liftKind: "adjusted_match" as const }))
    .sort((a, b) => b.score - a.score || (b.you + (b.them ?? 0)) - (a.you + (a.them ?? 0)) || a.name.localeCompare(b.name));
  const allNegative = ordered.length > 0 && ordered.every(area => area.lift < 0);
  return ordered.slice(0, 8).map((area, i) => ({ ...area, rank: i + 1, rankingNote: undefined,
    ...(i === 0 && allNegative ? { rankingNote: "All scored neighborhoods have a negative adjusted match lift with these settings." } : {}),
  }));
}

export async function rankNeighborhoods(state: ExploreState, field?: TasteField): Promise<Neighborhood[]> {
  const [taste, evidence, individual] = await Promise.all([
    field ?? buildField(state), getCityEvidence(state),
    loadLoveMaps(state.city, state.loves),
  ]);
  const { yours, theirs, fingerprint } = evidence;
  const series = loveSeries(individual, new Set(taste.cells.map((cell) => cell.h)));
  const radius = focusRadius(taste.center, taste.cells);
  const groups = new Map<string, { name: string; places: Map<string, QlooRecord> }>();
  for (const row of [...yours, ...(theirs ?? [])]) {
    const name = neighborhoodName(row);
    const id = string(row.entity_id);
    if (!name || !id || normalizedAreaName(name) === normalizedAreaName(state.city) ||
      normalizedAreaName(name) === normalizedAreaName(state.city.split(",")[0]) || haversine(taste.center, coordinates(row)!) > radius) continue;
    const key = neighborhoodId(state.city, name);
    const group = groups.get(key) ?? { name, places: new Map<string, QlooRecord>() };
    group.places.set(id, row);
    groups.set(key, group);
  }
  const centers = [...groups].filter(([, group]) => group.places.size >= 3).map(([id, group]) => ({
    id, name: group.name, places: [...group.places.values()], cells: [] as TasteField["cells"],
    center: [median([...group.places.values()].map((row) => coordinates(row)![0])), median([...group.places.values()].map((row) => coordinates(row)![1]))] as [number, number],
  }));
  for (const cell of taste.cells) {
    let nearest: typeof centers[number] | undefined;
    let distance = 1600;
    for (const group of centers) {
      const d = haversine([cell.lon, cell.lat], group.center);
      if (d <= distance) { nearest = group; distance = d; }
    }
    nearest?.cells.push(cell);
  }
  const fingerprintTags = [...fingerprint.you, ...(fingerprint.them ?? [])];
  const result: Neighborhood[] = centers.filter((group) => group.cells.some((cell) => cell.you > 0 || (cell.them ?? 0) > 0)).map((group) => {
    // Equal-cell means with a neutral prior: more cells add evidence, never a count score.
    const you = areaMatchScore(group.cells, state.discovery);
    const them = state.companion ? areaMatchScore(group.cells, state.discovery, "them") : undefined;
    const drivers = neighborhoodDrivers(series, taste.cells.map((cell) => cell.h), group.cells.map((cell) => cell.h));
    const matchedTags = matchedPlaceTags(group.places, fingerprintTags);
    const popularity = mean(group.places.map((row) => unit(row.popularity)));
    return { id: group.id, name: group.name, center: group.center, score: them === undefined ? you : Math.min(you, them), you,
      ...(them === undefined ? {} : { them }), rank: 1, drivers, matchedTags, vibe: popularity > 0.85 ? "touristy" : popularity > 0.6 ? "mixed" : "local",
      crowd: popularity > 0.85 ? "busy" : popularity > 0.6 ? "moderate" : "quiet",
      samplePlaces: [...new Set(group.places.map((row) => string(row.name)).filter((name): name is string => !!name))].slice(0, 3), cellIds: group.cells.map((cell) => cell.h) };
  });
  return orderNeighborhoods(result);
}
