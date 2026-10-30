import { activeLoves, apiError, HomeRequest, HomeResult, type ExploreState, type ResolvedLove, type TagRef } from "@/shared/contracts";
import { geocode, LonLat } from "@/server/geo/geocode";
import { qlooGet, record, records, resultRows, string, unit, type QlooRecord } from "@/server/qloo/client";
import { tagRef } from "@/server/qloo/search";
import { cityCenter } from "./city";
import { buildField } from "./field";
import { matchedPlaceTags, placeTasteTag, tagName } from "./fingerprint";
import { coordinates, haversine } from "./geo";
import { rankNeighborhoods, neighborhoodName, normalizedAreaName } from "./neighborhoods";
import { bestCategory, displayName } from "./places";
import { signals } from "./signals";
type HomePlace = HomeResult["source"]["places"][number];

export function homeTags(rows: QlooRecord[], limit = 6): TagRef[] {
  const counts = new Map<string, { tag: TagRef; count: number }>();
  for (const row of rows) {
    const unique = new Map(records(row.tags).map(tagRef).filter((tag): tag is TagRef => !!tag && placeTasteTag(tag)).map((tag) => [tagName(tag.name), tag]));
    for (const [key, tag] of unique) counts.set(key, { tag, count: (counts.get(key)?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || Number(a.tag.kind === "genre") - Number(b.tag.kind === "genre") || a.tag.name.localeCompare(b.tag.name))
    .slice(0, limit).map(({ tag }) => tag);
}

export function homePlace(row: QlooRecord): HomePlace {
  return { id: string(row.entity_id)!, name: displayName(string(row.name)!), category: bestCategory(row), tags: homeTags([row], 4).map((tag) => tag.name) };
}

export function signaturePlaces(rows: QlooRecord[], center: [number, number]): QlooRecord[] {
  const pool = [...new Map(rows.filter((row) => string(row.entity_id) && string(row.name) && record(row.properties).is_closed !== true &&
    coordinates(row) && haversine(center, coordinates(row)!) <= 1200).map((row) => [string(row.entity_id)!, row])).values()]
    .sort((a, b) => unit(b.popularity) - unit(a.popularity) || string(a.entity_id)!.localeCompare(string(b.entity_id)!));
  const selected: QlooRecord[] = [];
  for (const category of ["coffee", "food", "drinks", "culture"] as const) {
    const first = pool.find((row) => bestCategory(row) === category);
    if (first) selected.push(first);
  }
  for (const row of pool) {
    if (selected.length === 8) break;
    if (selected.includes(row) || (bestCategory(row) === "stay" && selected.some((item) => bestCategory(item) === "stay"))) continue;
    selected.push(row);
  }
  return selected;
}

export function homeLoves(places: HomePlace[]): ResolvedLove[] {
  return places.map((place) => ({ query: place.name, chosen: { id: place.id, name: place.name, domain: "place" }, candidates: [], weight: 1 / places.length }));
}

/** Internal signals may exceed eight; the user's editable profile and its eight-love limit remain intact. */
export function homeState(state: ExploreState, places: HomePlace[], blend: number): ExploreState {
  const personal = activeLoves(state.loves);
  const total = personal.reduce((sum, love) => sum + love.weight, 0);
  return { ...state, companion: null, neighborhood: null, loves: [...homeLoves(places),
    ...(blend && total ? personal.map((love) => ({ ...love, weight: blend * love.weight / total })) : [])] };
}

export function homeTwins(source: HomePlace[], rows: QlooRecord[]): HomeResult["matches"][number]["twins"] {
  const targets = rows.filter((row) => string(row.entity_id) && string(row.name) && record(row.properties).is_closed !== true)
    .sort((a, b) => unit(record(b.query).affinity) - unit(record(a.query).affinity) || string(a.entity_id)!.localeCompare(string(b.entity_id)!));
  const used = new Set<string>();
  const twins: HomeResult["matches"][number]["twins"] = [];
  for (const row of targets) {
    const target = homePlace(row);
    const origin = source.filter((place) => place.category && place.category === target.category && place.id !== target.id && !used.has(place.id))
      .map(place => ({ place, overlap: place.tags.filter(tag => distinctiveTwinTag(tag) && target.tags.some(t => tagName(t) === tagName(tag))).length }))
      .filter(item => item.overlap > 0).sort((a, b) => b.overlap - a.overlap)[0]?.place;
    if (!origin || used.has(target.id)) continue;
    twins.push({ source: origin, target }); used.add(origin.id); used.add(target.id);
    if (twins.length === 3) break;
  }
  return twins;
}

export function distinctiveTwinTag(name: string): boolean {
  return !new Set(["casual", "modern", "social", "unique", "charming", "classy", "fun", "lively", "busy", "comfortable", "energetic"]).has(tagName(name));
}

/** Weighted Jaccard of venue-frequency taste profiles: sparse/disjoint evidence stays low. */
export function homeSimilarity(source: QlooRecord[], target: QlooRecord[]): number {
  const vector = (rows: QlooRecord[]) => {
    const values = new Map<string, number>();
    for (const row of rows) for (const tag of homeTags([row], 100)) {
      const name = tagName(tag.name);
      values.set(name, (values.get(name) ?? 0) + 1 / rows.length);
    }
    return values;
  };
  const a = vector(source), b = vector(target);
  let intersection = 0, union = 0;
  for (const name of new Set([...a.keys(), ...b.keys()])) {
    intersection += Math.min(a.get(name) ?? 0, b.get(name) ?? 0);
    union += Math.max(a.get(name) ?? 0, b.get(name) ?? 0);
  }
  return union ? Math.round(100 * intersection / union) : 0;
}

export async function findHome(input: HomeRequest): Promise<HomeResult> {
  const { state, source, blend } = HomeRequest.parse(input);
  if (source.point && !LonLat.safeParse(source.point).success) throw apiError("bad_input", "Coordinates must be a valid longitude and latitude.");
  const city = await cityCenter(source.city);
  const center = source.point ?? (await geocode(`${source.neighborhood}, ${source.city}`, city, 30000))?.center;
  if (!center || haversine(city, center) > 30000) throw apiError("not_found", `We couldn't find ${source.neighborhood} in ${source.city}.`);
  const response = await qlooGet("/v2/insights", { "filter.type": "urn:entity:place",
    "filter.location": `POINT(${center[0]} ${center[1]})`, "filter.location.radius": 1200, take: 30 });
  const rows = signaturePlaces(resultRows(response, "entities"), center);
  if (!rows.length) throw apiError("not_found", `We couldn't find enough places in ${source.neighborhood}, ${source.city}.`);
  const places = rows.map(homePlace);
  const tags = homeTags(rows);
  const internal = homeState(state, places, blend);
  const field = await buildField(internal, blend > 0 ? { groups: [
    { loves: homeLoves(places), weight: 1 }, { loves: state.loves, weight: blend },
  ] } : undefined);
  const neighborhoods = await rankNeighborhoods(internal, field);
  const matches = await Promise.all(neighborhoods.slice(0, 3).map(async (neighborhood) => {
    const response = await qlooGet("/v2/insights", { "filter.type": "urn:entity:place",
      "filter.location": `POINT(${neighborhood.center[0]} ${neighborhood.center[1]})`, "filter.location.radius": 900,
      ...signals(homeLoves(places)), take: 30 });
    const nearby = resultRows(response, "entities").filter((row) => coordinates(row) && record(row.properties).is_closed !== true &&
      haversine(neighborhood.center, coordinates(row)!) <= 900 && normalizedAreaName(neighborhoodName(row) ?? "") === normalizedAreaName(neighborhood.name));
    const matched = new Set(matchedPlaceTags(nearby, tags, true, 6).map(tagName));
    return { neighborhoodId: neighborhood.id, similarity: homeSimilarity(rows, nearby),
      sharedTags: tags.filter((tag) => matched.has(tagName(tag.name))).slice(0, 4).map((tag) => tag.name), twins: homeTwins(places, nearby) };
  }));
  return HomeResult.parse({ source: { city: source.city, neighborhood: source.neighborhood, center, places, tags: tags.map((tag) => tag.name) }, field, neighborhoods, matches });
}
