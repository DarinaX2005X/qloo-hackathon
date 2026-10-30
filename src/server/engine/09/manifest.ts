import { apiError } from "@/shared/contracts";
import type { AreaIdentity, EvidenceRef, LonLat, PlaceV2 } from "@/shared/contracts-09";
import { validateCity, LOCALITY_RESOLUTION_VERSION } from "@/server/geo/geocode";
import { qlooRead, resultRows, string, type QlooRecord } from "@/server/qloo/client";
import { haversine, median, mean } from "../geo";
import { neighborhoodName } from "../neighborhoods";
import { DerivedCache, DAY_TTL, evidenceRef, hash, MANIFEST_SCHEMA, mapLimit, normalized } from "./core";
import { areaMembership, type AreaCell, pointInArea } from "./geometry";
import { dedupePlaces, rowPlace, venueEligibility } from "./eligibility";
import { fixedContexts, type ContextCell } from "./context-ranking";

export const NEUTRAL_FAMILIES = {
  coffee: ["urn:tag:genre:place:restaurant:coffee_shop", "urn:tag:category:place:cafe", "urn:tag:genre:place:restaurant:bakery"],
  food: ["urn:tag:category:place:restaurant"],
  nightlife: ["urn:tag:genre:place:restaurant:bar", "urn:tag:genre:place:night_club", "urn:tag:genre:place:nightclub"],
  culture: ["urn:tag:genre:place:book_store", "urn:tag:genre:place:museum", "urn:tag:genre:place:art_gallery", "urn:tag:genre:place:live_music_venue"],
} as const;
export type ManifestArea = { identity: AreaIdentity; cells: AreaCell[]; contextCells?: ContextCell[]; venueIds: string[]; neutralScore: number };
export type CityManifest = {
  cityId: string; cityName: string; country: string; center: LonLat; radiusM: number; version: string; fetchedAt: string;
  areas: ManifestArea[]; contextCells?: ContextCell[]; catalog: PlaceV2[]; rows: QlooRecord[]; evidence: EvidenceRef[]; notes: string[];
};
const manifests = new DerivedCache<CityManifest>(40, DAY_TTL, `manifests:${MANIFEST_SCHEMA}`);
export function clearManifestCache(): void { manifests.clear(); }
export function localityId(name: string, country: string, point: LonLat): string { return `city:${normalized(name).replace(/ /g, "-")}:${normalized(country).replace(/ /g, "-")}:${point[0].toFixed(3)},${point[1].toFixed(3)}`; }
export function canonicalAreaId(cityId: string, name: string): string { return `${cityId}:area:${normalized(name).replace(/ /g, "-")}`; }
export async function cityManifest(city: string): Promise<{ value: CityManifest; hit: boolean }> {
  const key = `${LOCALITY_RESOLUTION_VERSION}:${normalized(city)}`, result = await manifests.get(key, () => buildCityManifest(city));
  if (result.value.notes.some(note => note.includes("was unavailable"))) manifests.delete(key);
  return result;
}
export async function buildCityManifest(city: string): Promise<CityManifest> {
  const resolved = await validateCity(city);
  const country = resolved.label.split(",").at(-1)?.trim() ?? resolved.label;
  const center = resolved.center, radiusM = 7500, cityId = localityId(resolved.name, country, center);
  const evidence: EvidenceRef[] = [evidenceRef("geocode", { fetchedAt: new Date().toISOString(), requestHash: hash(["validate_city", resolved.query, center]) })];
  const notes: string[] = [];
  const batches = await mapLimit(Object.entries(NEUTRAL_FAMILIES).flatMap(([family, tags]) => [1, 2].map(page => ({ family, tags, page }))), 4, async ({ family, tags, page }) => {
    try {
      const read = await qlooRead("/v2/insights", { "filter.type": "urn:entity:place", "filter.location": `POINT(${center[0]} ${center[1]})`, "filter.location.radius": radiusM, "filter.tags": tags.join(","), "operator.filter.tags": "union", take: 50, page });
      const rows = resultRows(read.value, "entities");
      evidence.push(evidenceRef("qloo_entity", read, rows.flatMap(row => string(row.entity_id) ?? [])));
      return rows;
    } catch { notes.push(`The neutral ${family} catalog page ${page} was unavailable.`); return []; }
  });
  const parsedRows = new Map<QlooRecord, PlaceV2 | null>();
  const parseRow = (row: QlooRecord) => {
    if (!parsedRows.has(row)) parsedRows.set(row, rowPlace(row));
    return parsedRows.get(row)!;
  };
  const rows = [...new Map(batches.flat().map(r => [string(r.entity_id), r])).values()].filter(row => {
    const p = parseRow(row);
    // Fixed geometry follows the neutral provider classifications. Conservative
    // name and primary-role suitability checks are applied to actual venue choices;
    // they must not shift the reference center or context-cell ownership.
    return !!p && venueEligibility(p, "daily_life", [], { center, radiusM, geometryCatalog: true }).allowed;
  });
  const catalog = dedupePlaces(rows.flatMap(row => parseRow(row) ?? [])).sort((a, b) => a.id.localeCompare(b.id));
  if (!catalog.length) throw apiError("qloo_unavailable", `Everyday place data for ${resolved.name} is unavailable. Please retry.`, true);
  const byName = new Map<string, { name: string; rows: QlooRecord[] }>();
  for (const row of rows) {
    const name = neighborhoodName(row);
    if (!name || normalized(name) === normalized(resolved.name)) continue;
    const key = normalized(name);
    const group = byName.get(key) ?? { name, rows: [] };
    group.rows.push(row); byName.set(key, group);
  }
  // Neutral data only. Name ordering keeps the selection independent of personal affinity.
  // Resolve up to 40 names, then diversify the 650m circles before selecting at most 24.
  const candidates = [...byName.values()].filter(g => g.rows.length >= 2).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name)).slice(0, 40);
  const located = candidates.map(group => {
    const points = group.rows.map(row => parseRow(row)!).map(place => [place.lon, place.lat] as LonLat);
    const fallback: LonLat = [median(points.map(p => p[0])), median(points.map(p => p[1]))];
    // Approximate neighborhoods use neutral POI medians. Resolving dozens of ambiguous
    // district centroids made the first reference manifest take 32–42s; that optional
    // refinement is cut. Source Home may still explicitly geocode an unknown area.
    const identity: AreaIdentity = { id: canonicalAreaId(cityId, group.name), name: group.name, aliases: [group.name], center: fallback, geometry: { kind: "circle", radiusM: 650 }, geometryQuality: "approximate" };
    return { identity, groupCount: group.rows.length };
  });
  const selected: typeof located = [];
  // Suppress redundant circle centers, never merge legal/colloquial neighborhood identities.
  for (const candidate of located) {
    if (!selected.some(previous => haversine(previous.identity.center, candidate.identity.center) < 500)) selected.push(candidate);
    if (selected.length === 24) break;
  }
  if (selected.length < 12) for (const candidate of located) {
    if (!selected.includes(candidate)) selected.push(candidate);
    if (selected.length >= Math.min(12, located.length)) break;
  }
  const areas = selected.map(({ identity }): ManifestArea => {
    const local = catalog.filter(p => pointInArea([p.lon, p.lat], identity));
    const categories = ["coffee", "food", "drinks", "culture"];
    const scores = categories.flatMap(category => {
      const popular = local.filter(p => p.category === category).map(p => p.popularity).sort((a, b) => b - a).slice(0, 6);
      return popular.length ? [mean(popular)] : [];
    });
    return { identity, cells: areaMembership(identity, center, radiusM), venueIds: local.map(p => p.id).sort(), neutralScore: mean(scores) };
  }).filter(area => area.cells.length).sort((a, b) => a.identity.id.localeCompare(b.identity.id));
  if (!areas.length) throw apiError("sparse_city", `Named areas could not be established around ${resolved.name}.`);
  const contexts = fixedContexts(areas.map(area => area.identity), catalog, center, radiusM);
  for (const area of areas) area.contextCells = contexts.areas.get(area.identity.id)!;
  notes.push("Approximate 650 m areas are centered on neutral catalog venues, rather than official neighborhood boundaries.");
  const fetchedAt = evidence.map(e => e.fetchedAt).sort()[0];
  const version = `${MANIFEST_SCHEMA}:${hash([cityId, center, areas.map(a => [a.identity, a.cells, a.contextCells]), catalog.map(p => p.id)])}`;
  if (areas.length < 10) notes.push("Fewer than ten named areas are available in the central search area.");
  return { cityId, cityName: resolved.name, country, center, radiusM, version, fetchedAt, areas, contextCells: contexts.grid, catalog, rows, evidence, notes };
}
