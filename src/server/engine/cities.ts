import { activeLoves, ApiError, apiError, type CityScore, type ExploreState, type TagRef } from "@/shared/contracts";
import { qlooGet, record, records, resultRows, string, unit, type QlooRecord } from "@/server/qloo/client";
import { tagRef } from "@/server/qloo/search";
import { cityCenter } from "./city";
import { HEAT_RADIUS } from "./field";
import { buildFingerprint, matchedPlaceTags, tagName } from "./fingerprint";
import { bestCategory } from "./places";
import { neighborhoodName, normalizedAreaName } from "./neighborhoods";
import { mean } from "./geo";
import { displayName } from "./places";
import { signals } from "./signals";
import { rankNeighborhoods } from "./neighborhoods";
import { validateCity } from "@/server/geo/geocode";

/** Fixed-denominator taste coverage, independent of Qloo's within-city affinity ranks. */
export function cityPlaceCoverage(row: QlooRecord, fingerprint: TagRef[]): number {
  const names = new Set(records(row.tags).map(tagRef).filter((tag): tag is TagRef => !!tag &&
    ["ambience", "decor", "genre"].includes(tag.kind)).map((tag) => tagName(tag.name)));
  const unique = new Map(fingerprint.map((tag) => [tagName(tag.name), tag]));
  let matched = 0;
  let total = 0;
  for (const [name, tag] of unique) {
    const weight = tag.kind === "genre" ? 0.5 : 1;
    total += weight;
    if (names.has(name)) matched += weight;
  }
  return total ? matched / total : 0;
}

export function emptyCity(city: string, center: [number, number] = [0, 0]): CityScore {
  return { city, score: 0, depth: 0, center, topNeighborhood: null, topPlaces: [], matchedTags: [], sparse: true,
    error: `We couldn't find enough places in ${city}` };
}

export function cityScoreFromRows(city: string, rows: QlooRecord[], center: [number, number], fingerprint: TagRef[]): CityScore {
  const unique = new Map<string, QlooRecord>();
  for (const row of rows) {
    const id = string(row.entity_id);
    if (id && string(row.name) && record(row.properties).is_closed !== true && !unique.has(id)) unique.set(id, row);
  }
  const places = [...unique.values()].slice(0, 50);
  if (!places.length) return emptyCity(city, center);
  const scored = places.map((row) => ({ row, coverage: cityPlaceCoverage(row, fingerprint), category: bestCategory(row) }))
    .sort((a, b) => b.coverage - a.coverage || unit(record(b.row.query).affinity) - unit(record(a.row.query).affinity) || String(a.row.entity_id).localeCompare(String(b.row.entity_id)));
  const neighborhoods = new Map<string, { name: string; affinity: number }>();
  for (const row of places) {
    const name = neighborhoodName(row);
    if (!name || normalizedAreaName(name) === normalizedAreaName(city.split(",")[0]) || normalizedAreaName(name) === normalizedAreaName(city)) continue;
    const key = normalizedAreaName(name);
    const group = neighborhoods.get(key) ?? { name, affinity: 0 };
    group.affinity += unit(record(row.query).affinity);
    neighborhoods.set(key, group);
  }
  // one card per place: Qloo can list the same venue twice under two ids
  const top = [...new Map(scored.filter((place) => place.category !== null)
    .map((place) => [normalizedAreaName(string(place.row.name)!), place])).values()].slice(0, 4);
  return { city, center, score: mean(scored.map((place) => place.coverage)),
    depth: scored.filter((place) => place.coverage >= 0.25).length / scored.length,
    topNeighborhood: [...neighborhoods.values()].sort((a, b) => b.affinity - a.affinity || a.name.localeCompare(b.name))[0]?.name ?? null,
    topPlaces: top.map(({ row, category }) => ({ name: displayName(string(row.name)!), category: category!, affinity: unit(record(row.query).affinity) })),
    matchedTags: matchedPlaceTags(top.map((place) => place.row), fingerprint.filter((tag) => tag.kind === "ambience" || tag.kind === "decor"), true, 4),
    sparse: places.length < 20 };
}

export async function scoreCity(state: ExploreState, city: string, fingerprint: TagRef[]): Promise<CityScore> {
  // around the centre, like the map: a place query by a big city's name ("New York") can outlast the timeout
  const center = await cityCenter(city);
  const response = await qlooGet("/v2/insights", { "filter.type": "urn:entity:place",
    "filter.location": `POINT(${center[0]} ${center[1]})`, "filter.location.radius": HEAT_RADIUS,
    ...signals([...state.loves, ...(state.companion?.loves ?? [])]), take: 50 });
  const score = cityScoreFromRows(city, resultRows(response, "entities"), center, fingerprint);
  if (score.error) return score;
  // the same neighborhood ranking the map uses, so "start in X" matches what opening the city shows
  const ranked = await rankNeighborhoods({ ...state, city, neighborhood: null }).catch(() => null);
  return ranked?.[0] ? { ...score, topNeighborhood: ranked[0].name } : score;
}

export async function compareCities(state: ExploreState, cities: string[]): Promise<CityScore[]> {
  await Promise.all(cities.map(city => validateCity(city)));
  if (!activeLoves([...state.loves, ...(state.companion?.loves ?? [])]).length)
    throw apiError("bad_input", "Choose at least one resolved love to compare cities.");
  const fingerprint = await buildFingerprint({ ...state, refinements: [] });
  // one city Qloo can't answer for becomes its own card, the rest of the comparison still stands
  const results = await Promise.all(cities.map((city) => scoreCity(state, city.trim(), [...fingerprint.you, ...(fingerprint.them ?? [])])
    .catch((error: unknown) => {
      const parsed = ApiError.safeParse(error);
      return { ...emptyCity(city.trim()), error: parsed.success && parsed.data.error.code === "not_found"
        ? parsed.data.error.message : `Qloo didn't answer for ${city.trim()} in time. Compare again to retry it.` };
    })));
  return results.sort((a, b) => b.score - a.score || b.depth - a.depth || a.city.localeCompare(b.city));
}
