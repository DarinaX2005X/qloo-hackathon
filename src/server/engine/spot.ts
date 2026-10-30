import { activeLoves, apiError, SpotRequest, SpotResult, type ExploreState, type FieldCell, type Neighborhood, type Place } from "@/shared/contracts";
import { geocode, LonLat, reverseGeocode } from "@/server/geo/geocode";
import { cityCenter } from "./city";
import { buildField } from "./field";
import { haversine, mean, walkMinutes } from "./geo";
import { normalizedAreaName, rankNeighborhoods } from "./neighborhoods";
import { placesNear } from "./places";
import { minutes } from "./plan";

/** Same projection, buckets, four neighbours and 20 m weight floor as map/hexgrid.ts. */
export function interpolateSpot(cells: FieldCell[], point: [number, number]): { score: number; drivers: Record<string, number> } | null {
  const kx = 111320 * Math.cos(mean(cells.map((cell) => cell.lat)) * Math.PI / 180);
  const x = point[0] * kx, y = point[1] * 110540;
  const nearby = cells.filter((cell) => Math.abs(Math.floor(cell.lon * kx / 1500) - Math.floor(x / 1500)) <= 1 &&
    Math.abs(Math.floor(cell.lat * 110540 / 1500) - Math.floor(y / 1500)) <= 1)
    .map((cell) => ({ cell, d2: (cell.lon * kx - x) ** 2 + (cell.lat * 110540 - y) ** 2 }))
    .sort((a, b) => a.d2 - b.d2).slice(0, 4);
  if (!nearby.length || nearby[0].d2 > 900 ** 2) return null;
  let total = 0, score = 0;
  const drivers: Record<string, number> = {};
  for (const { cell, d2 } of nearby) {
    const weight = 1 / Math.max(d2, 400);
    total += weight; score += cell.you * weight;
    for (const [domain, share] of Object.entries(cell.drivers)) drivers[domain] = (drivers[domain] ?? 0) + share * weight;
  }
  return { score: score / total, drivers: Object.fromEntries(Object.entries(drivers).map(([domain, value]) => [domain, value / total])) };
}

export function spotPercentile(cells: FieldCell[], score: number): number {
  return cells.length ? Math.round(100 * cells.filter((cell) => cell.you < score).length / cells.length) : 0;
}

export function geohashContains(hash: string, point: [number, number]): boolean {
  const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz";
  const ranges = [[-180, 180], [-90, 90]];
  let axis = 0;
  for (const char of hash) {
    const value = alphabet.indexOf(char);
    if (value < 0) return false;
    for (let bit = 4; bit >= 0; bit--) {
      const range = ranges[axis];
      range[(value & (1 << bit)) ? 0 : 1] = (range[0] + range[1]) / 2;
      axis = 1 - axis;
    }
  }
  return !!hash && point.every((value, i) => value >= ranges[i][0] && value < ranges[i][1]);
}

export function spotNeighborhood(neighborhoods: Neighborhood[], point: [number, number]): SpotResult["neighborhood"] {
  const contained = neighborhoods.find((item) => item.cellIds.some((hash) => geohashContains(hash, point)));
  const nearest = neighborhoods.map((item) => ({ item, distance: haversine(item.center, point) }))
    .filter(({ distance }) => distance <= 1500).sort((a, b) => a.distance - b.distance)[0]?.item;
  const found = contained ?? nearest;
  return found ? { id: found.id, name: found.name, rank: found.rank } : null;
}

export function spotDrivers(drivers: Record<string, number>, state: ExploreState): SpotResult["drivers"] {
  const loves = activeLoves(state.loves);
  const contributions = loves.map((love) => {
    const domain = love.chosen.domain;
    const total = loves.filter((item) => item.chosen.domain === domain).reduce((sum, item) => sum + item.weight, 0);
    return { love: love.chosen.name, share: (drivers[domain] ?? 0) * love.weight / total };
  }).filter((item) => item.share > 0).sort((a, b) => b.share - a.share).slice(0, 4);
  const total = contributions.reduce((sum, item) => sum + item.share, 0);
  return contributions.map((item) => ({ ...item, share: item.share / total }));
}

export function opensLate(place: Place): boolean {
  return Object.values(place.hours ?? {}).some((spans) => spans.some((span) => {
    const close = minutes(span.closes), open = minutes(span.opens);
    return Number.isFinite(close) && Number.isFinite(open) && (close >= 23 * 60 || close <= open || close <= 6 * 60);
  }));
}

export function placeBrandKey(place: Pick<Place, "name" | "neighborhood">): string {
  const name = place.name.replace(/\s*\([^()]*\)\s*$/u, "").replace(/\s*\[[^\[\]]*\]\s*$/u, "")
    .split(/\s+[-–—|/]\s+|[–—|]|:\s+/u)[0];
  const normalize = (text: string) => normalizedAreaName(text).replace(/[’']/gu, "").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  let key = normalize(name).replace(/\s+(?:branch|location|store)\s+\d+$/u, "");
  const area = normalize(place.neighborhood ?? "");
  if (area && key.endsWith(` ${area}`)) key = key.slice(0, -area.length).trim();
  return key || normalize(place.name);
}

export function spotWalk(places: Place[], point: [number, number]): Pick<SpotResult, "walk" | "counts"> {
  const ids = new Set<string>();
  const names = new Set<string>();
  // Pick the nearest usable branch before counting or limiting the list, independent of Qloo result order.
  const candidates = places.map((place) => ({ place, minutes: walkMinutes(point, [place.lon, place.lat]) }))
    .filter(({ place, minutes }) => place.category !== "stay" && place.affinity > 0 && minutes <= 12)
    .sort((a, b) => a.minutes - b.minutes || b.place.affinity - a.place.affinity || a.place.id.localeCompare(b.place.id))
    .filter(({ place }) => {
      const key = placeBrandKey(place);
      if (ids.has(place.id) || names.has(key)) return false;
      ids.add(place.id); names.add(key); return true;
    }).map(({ place, minutes }) => ({ place, minutes: Math.round(minutes) }));
  const counts = { coffee: 0, food: 0, drinks: 0, culture: 0, openLate: 0 };
  for (const { place } of candidates) {
    if (place.category !== "stay") counts[place.category]++;
    if (opensLate(place)) counts.openLate++;
  }
  return { walk: candidates.slice(0, 10), counts };
}

export function spotVerdict(city: string, percentile: number, neighborhood: SpotResult["neighborhood"], counts: SpotResult["counts"], street?: string): string {
  const labels = [["coffee", "café", "cafés"], ["food", "restaurant", "restaurants"], ["drinks", "bar", "bars"], ["culture", "culture stop", "culture stops"]] as const;
  const listed = labels.filter(([key]) => counts[key]).map(([key, one, many]) => `${counts[key]} ${counts[key] === 1 ? one : many}`);
  const nearby = listed.length ? `${listed.join(", ").replace(/, ([^,]*)$/, " and $1")} that fit you within 12 minutes` : "no matching walkable places found within 12 minutes";
  return `${street ? `${street} (the street, house number not found) is better` : "Better"} than ${percentile}% of mapped ${city} for your taste${neighborhood ? `, in ${neighborhood.name} (#${neighborhood.rank})` : ""}, with ${nearby}.`;
}

export async function checkSpot(input: SpotRequest): Promise<SpotResult> {
  const { state, query, point: supplied } = SpotRequest.parse(input);
  if (supplied && !LonLat.safeParse(supplied).success) throw apiError("bad_input", "Coordinates must be a valid longitude and latitude.");
  const center = await cityCenter(state.city);
  const found = supplied ? null : await geocode(`${query}, ${state.city}`, center, 25000);
  const point = supplied ?? found?.center;
  if (!point || haversine(center, point) > 25000) throw apiError("not_found", `We couldn't find that address in ${state.city}.`);
  const [field, places, pinLabel] = await Promise.all([buildField(state),
    placesNear(state, { center: point }, ["coffee", "food", "drinks", "culture"], undefined, { radius: 1000, take: 30, perCategory: 50 }),
    supplied && !query ? reverseGeocode(point) : null,
  ]);
  const value = interpolateSpot(field.cells, point);
  if (!value) throw apiError("not_found", `There is no mapped taste signal at that address in ${state.city}.`);
  const ranked = await rankNeighborhoods(state, field);
  const percentile = spotPercentile(field.cells, value.score);
  const neighborhood = spotNeighborhood(ranked, point);
  const { walk, counts } = spotWalk(places, point);
  const label = found?.label ?? query ?? pinLabel ?? neighborhood?.name ?? "Pinned spot";
  return SpotResult.parse({ label, point, score: value.score, percentile, neighborhood,
    drivers: spotDrivers(value.drivers, state), walk, counts, verdict: spotVerdict(state.city, percentile, neighborhood, counts, found?.streetLevel ? found.street ?? found.name : undefined) });
}
