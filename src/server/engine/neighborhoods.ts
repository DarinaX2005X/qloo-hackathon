import { type ExploreState, type Neighborhood, type ResolvedLove, type TasteField } from "@/shared/contracts";
import { qlooGet, record, resultRows, string, unit, type QlooRecord } from "@/server/qloo/client";
import { buildField, loadLoveMaps, loveSeries } from "./field";
import { buildFingerprint, matchedPlaceTags } from "./fingerprint";
import { coordinates, focusRadius, haversine, mean, median, percentileRanks } from "./geo";
import { signals } from "./signals";

export { coordinates } from "./geo";

export function neighborhoodName(row: QlooRecord): string | undefined {
  const properties = record(row.properties);
  return string(properties.neighborhood) ?? string(record(properties.neighborhood).name) ?? string(record(properties.geocode).name);
}

export function neighborhoodId(city: string, name: string): string {
  return `${encodeURIComponent(city.trim().toLowerCase())}:${encodeURIComponent(name.trim().toLowerCase())}`;
}

export async function cityPlaces(state: ExploreState, loves: ResolvedLove[] = state.loves): Promise<QlooRecord[]> {
  const pages = await Promise.all([1, 2, 3].map(async (page) => resultRows(await qlooGet("/v2/insights", {
    "filter.type": "urn:entity:place", "filter.location.query": state.city, ...signals(loves, state.refinements), take: 50, page,
  }), "entities")));
  const found = new Map<string, QlooRecord>();
  for (const row of pages.flat()) {
    const id = string(row.entity_id);
    if (id && coordinates(row) && record(row.properties).is_closed !== true && !found.has(id)) found.set(id, row);
  }
  return [...found.values()].slice(0, 150);
}

export async function rankNeighborhoods(state: ExploreState, field?: TasteField): Promise<Neighborhood[]> {
  const [taste, yours, theirs, fingerprint, individual] = await Promise.all([
    field ?? buildField(state), cityPlaces(state), state.companion ? cityPlaces(state, state.companion.loves) : undefined, buildFingerprint(state),
    loadLoveMaps(state.city, state.loves),
  ]);
  const series = loveSeries(individual, new Set(taste.cells.map((cell) => cell.h)));
  const radius = focusRadius(taste.center, taste.cells);
  const youById = new Map(yours.map((row) => [string(row.entity_id), unit(record(row.query).affinity)]));
  const themById = new Map(theirs?.map((row) => [string(row.entity_id), unit(record(row.query).affinity)]) ?? []);
  const groups = new Map<string, { name: string; places: Map<string, QlooRecord> }>();
  for (const row of [...yours, ...(theirs ?? [])]) {
    const name = neighborhoodName(row);
    const id = string(row.entity_id);
    if (!name || !id || haversine(taste.center, coordinates(row)!) > radius) continue;
    const key = neighborhoodId(state.city, name);
    const group = groups.get(key) ?? { name, places: new Map<string, QlooRecord>() };
    group.places.set(id, row);
    groups.set(key, group);
  }
  const centers = [...groups].filter(([, group]) => group.places.size >= 2).map(([id, group]) => ({
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
    const you = 0.7 * mean(group.cells.map((cell) => cell.you).sort((a, b) => b - a).slice(0, 3)) + 0.3 * mean(group.places.map((row) => youById.get(string(row.entity_id)) ?? 0));
    const them = state.companion ? 0.7 * mean(group.cells.map((cell) => cell.them ?? 0).sort((a, b) => b - a).slice(0, 3)) + 0.3 * mean(group.places.map((row) => themById.get(string(row.entity_id)) ?? 0)) : undefined;
    const contributions = series.map((item) => ({ love: item.love,
      value: item.love.weight * group.cells.reduce((sum, cell) => sum + (item.values.get(cell.h) ?? 0), 0) }));
    const total = contributions.reduce((sum, item) => sum + item.value, 0);
    const drivers = contributions.filter((item) => item.value > 0).map(({ love, value }) => ({ domain: love.chosen.domain, share: total ? value / total : 0,
      love: love.chosen.name,
    })).sort((a, b) => b.share - a.share);
    const matchedTags = matchedPlaceTags(group.places, fingerprintTags);
    const popularity = mean(group.places.map((row) => unit(row.popularity)));
    return { id: group.id, name: group.name, center: group.center, score: them === undefined ? you : Math.min(you, them), you,
      ...(them === undefined ? {} : { them }), rank: 1, drivers, matchedTags, vibe: popularity > 0.85 ? "touristy" : popularity > 0.6 ? "mixed" : "local",
      samplePlaces: [...new Set(group.places.map((row) => string(row.name)).filter((name): name is string => !!name))].slice(0, 3), cellIds: group.cells.map((cell) => cell.h) };
  });
  const percentiles = percentileRanks(result.map((group) => group.score));
  return result.map((group, i) => ({ ...group, score: 0.35 + 0.63 * percentiles[i] }))
    .sort((a, b) => b.score - a.score || (b.you + (b.them ?? 0)) - (a.you + (a.them ?? 0)) || a.name.localeCompare(b.name))
    .slice(0, 8).map((group, i) => ({ ...group, rank: i + 1 }));
}
