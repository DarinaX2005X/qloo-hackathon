import { activeLoves, DOMAINS, type Domain, type ExploreState, type ResolvedLove, type TasteField, apiError } from "@/shared/contracts";
import { qlooGet, record, resultRows, string, number, unit, type QlooRecord } from "@/server/qloo/client";
import { qlooDomain } from "@/server/qloo/domains";
import { signals } from "./signals";
import { focusRadius, haversine, mean, percentileRanks } from "./geo";
import { cityCenter } from "./city";
import { getCityEvidence } from "./evidence";

export type HeatCell = { h: string; lat: number; lon: number; affinity: number; popularity: number; affinities: Partial<Record<Domain, number>> };
export type LoveMap = { love: ReturnType<typeof activeLoves>[number]; cells: HeatCell[] };
export type LoveSeries = { love: LoveMap["love"]; values: Map<string, number> };
export type PersonMaps = { combined: HeatCell[]; individual: LoveMap[] };
export type PersonField = { scores: Map<string, number>; drivers: Map<string, Record<string, number>>; missing: string[] };
export type FieldOptions = { groups: { loves: ResolvedLove[]; weight: number }[] };

export function heatCell(row: QlooRecord): HeatCell | null {
  const location = record(row.location);
  const query = record(row.query);
  const h = string(location.geohash);
  const lat = number(location.latitude, NaN);
  const lon = number(location.longitude, NaN);
  if (!h || h.length < 6 || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const affinities: HeatCell["affinities"] = {};
  for (const domain of DOMAINS) {
    const value = query[`entity_${qlooDomain(domain)}_affinity`] ?? query[`entity_${domain}_affinity`];
    if (typeof value === "number" && Number.isFinite(value)) affinities[domain] = unit(value);
  }
  return { h, lat, lon, affinity: unit(query.affinity), popularity: unit(query.popularity), affinities };
}

/**
 * Qloo answers a heatmap with geohash-7 cells (~150 m) around a point. The engine and the map work on
 * geohash-6 (~1.2 x 0.6 km), so finer cells are folded into their parent: coordinates and scores are means.
 */
export function foldCells(cells: HeatCell[]): HeatCell[] {
  const groups = new Map<string, HeatCell[]>();
  for (const cell of cells) {
    const key = cell.h.slice(0, 6);
    const group = groups.get(key);
    if (group) group.push(cell);
    else groups.set(key, [cell]);
  }
  return [...groups].map(([h, group]) => {
    if (group.length === 1) return { ...group[0], h };
    const affinities: HeatCell["affinities"] = {};
    for (const domain of DOMAINS) {
      const values = group.flatMap((cell) => cell.affinities[domain] ?? []);
      if (values.length) affinities[domain] = mean(values);
    }
    return { h, lat: mean(group.map((cell) => cell.lat)), lon: mean(group.map((cell) => cell.lon)),
      affinity: mean(group.map((cell) => cell.affinity)), popularity: mean(group.map((cell) => cell.popularity)), affinities };
  });
}

/** Radius around the city centre that the heatmap covers; matches the widest focus radius. */
export const HEAT_RADIUS = 15000;

export async function heatmap(city: string, loves: ResolvedLove[], tagId?: string): Promise<HeatCell[]> {
  const signal = tagId ? { "signal.interests.tags": tagId } : signals(loves);
  if (!tagId && !activeLoves(loves).length) return [];
  // A point and radius, not the city name: by name Qloo picks the grid size per place
  // ("Tokyo" comes back as 5 km cells across the prefecture), around a point it is always the same.
  const center = await cityCenter(city);
  const response = await qlooGet("/v2/insights", {
    "filter.type": "urn:heatmap", "filter.location": `POINT(${center[0]} ${center[1]})`, "filter.location.radius": HEAT_RADIUS, ...signal, take: 50,
  });
  return foldCells(resultRows(response, "heatmap").map(heatCell).filter((cell): cell is HeatCell => cell !== null));
}

export async function loadLoveMaps(city: string, loves: ResolvedLove[]): Promise<LoveMap[]> {
  // Each URL depends only on city + entity id, so profile edits reuse previous Qloo cache entries.
  // A love Qloo can't map (an obscure namesake, a game) contributes nothing instead of failing the field.
  return Promise.all(activeLoves(loves).map(async (love) => ({ love, cells: await heatmap(city, [love]).catch(() => []) })));
}

export async function loadPersonMaps(city: string, loves: ResolvedLove[]): Promise<PersonMaps> {
  const [combined, individual] = await Promise.all([heatmap(city, loves).catch(() => null), loadLoveMaps(city, loves)]);
  if (combined) return { combined, individual };
  // Qloo rejected the joint request (one love it can't map); rebuild it from the loves that did map.
  const mapped = individual.filter((m) => m.cells.length).map((m) => m.love);
  return { combined: mapped.length ? await heatmap(city, mapped) : [], individual };
}

/** Rank only observed cells in the city window. Missing observations retain zero support. */
export function localPercentiles(cells: HeatCell[], retained: Set<string>): Map<string, number> {
  const local = [...new Map(cells.filter((cell) => retained.has(cell.h)).map((cell) => [cell.h, cell])).values()];
  const ranks = percentileRanks(local.map((cell) => cell.affinity));
  return new Map(local.map((cell, i) => [cell.h, cell.affinity > 0 ? ranks[i] : 0]));
}

export function loveSeries(maps: LoveMap[], retained: Set<string>): LoveSeries[] {
  return maps.map(({ love, cells }) => ({ love, values: localPercentiles(cells, retained) }))
    .filter((series) => [...series.values.values()].some((value) => value > 0));
}

/** Preserve the combined Qloo signal and apply domain weights before local ranking. */
export function weightedAffinity(cell: HeatCell, loves: ResolvedLove[]): number {
  let weighted = 0;
  let weights = 0;
  for (const love of activeLoves(loves)) {
    const value = cell.affinities[love.chosen.domain];
    if (value === undefined) continue;
    weighted += love.weight * value;
    weights += love.weight;
  }
  return weights ? weighted / weights : cell.affinity;
}

export function personField(state: ExploreState, maps: PersonMaps, tags: Map<string, number>[], cells: HeatCell[]): PersonField {
  const retained = new Set(cells.map((cell) => cell.h));
  const series = loveSeries(maps.individual, retained);
  const weight = series.reduce((sum, item) => sum + item.love.weight, 0);
  const contributions = cells.map((cell) => series.map((item) => ({
    domain: item.love.chosen.domain, value: item.love.weight * (item.values.get(cell.h) ?? 0),
  })));
  const combined = new Map(maps.combined.map((cell) => [cell.h, cell]));
  const rawIndividual = maps.individual.map((item) => ({ love: item.love, cells: new Map(item.cells.map((cell) => [cell.h, cell])) }));
  const mixtures = cells.map((cell) => {
    if (!series.length) return 0;
    const aggregate = combined.get(cell.h);
    if (aggregate) return weightedAffinity(aggregate, series.map((item) => item.love));
    return weight ? rawIndividual.reduce((sum, item) => sum + item.love.weight * (item.cells.get(cell.h)?.affinity ?? 0), 0) / weight : 0;
  });
  const supported = mixtures.flatMap((value, index) => value > 0 ? [{ value, index }] : []);
  const ranks = percentileRanks(supported.map((item) => item.value));
  const base = new Map(supported.map((item, i) => [item.index, ranks[i]]));
  const scores = new Map<string, number>();
  const drivers: PersonField["drivers"] = new Map();
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const byDomain: Record<string, number> = {};
    for (const item of contributions[i]) byDomain[item.domain] = (byDomain[item.domain] ?? 0) + item.value;
    const total = Object.values(byDomain).reduce((sum, value) => sum + value, 0);
    drivers.set(cell.h, Object.fromEntries(Object.entries(byDomain).filter(([, value]) => value > 0).map(([domain, value]) => [domain, value / total])));
    const affinity = base.get(i) ?? 0;
    const refined = tags.length ? (series.length ? 0.65 * affinity : 0) + (series.length ? 0.35 : 1) * mean(tags.map((tag) => tag.get(cell.h) ?? 0)) : affinity;
    scores.set(cell.h, refined * (1 - 0.7 * state.discovery * cell.popularity));
  }
  const max = Math.max(0, ...scores.values());
  if (max) for (const [h, score] of scores) scores.set(h, score / max);
  return { scores, drivers, missing: maps.individual.filter(({ cells }) => !cells.some((cell) => cell.affinity > 0)).map(({ love }) => love.query) };
}

export async function buildField(state: ExploreState, options?: FieldOptions): Promise<TasteField> {
  const [center, yours, theirs, tagMaps] = await Promise.all([
    cityCenter(state.city), loadPersonMaps(state.city, state.loves),
    state.companion ? loadPersonMaps(state.city, state.companion.loves) : undefined,
    Promise.all(state.refinements.map((tag) => heatmap(state.city, [], tag.id))),
    // Warm the next pipeline stage; a failed prefetch must not hide an otherwise usable field.
    getCityEvidence(state).catch(() => undefined),
  ]);
  // Combined maps supply shared coordinates/popularity; individual maps extend sparse coverage.
  const all = new Map<string, HeatCell>();
  for (const map of [yours.combined, theirs?.combined ?? [], ...yours.individual.map((item) => item.cells),
    ...(theirs?.individual.map((item) => item.cells) ?? []), ...tagMaps])
    for (const cell of map) if (!all.has(cell.h)) all.set(cell.h, cell);
  const radius = focusRadius(center, [...all.values()]);
  const local = [...all.values()].filter((cell) => haversine(center, [cell.lon, cell.lat]) <= radius).sort((a, b) => a.h.localeCompare(b.h));
  const retained = new Set(local.map((cell) => cell.h));
  const tags = tagMaps.map((map) => localPercentiles(map, retained)).filter((map) => [...map.values()].some((value) => value > 0));
  const you = personField(state, yours, tags, local);
  if (options?.groups.length) {
    // Blend complete signals after their own within-city ranking, including two signals in the same domain.
    const loaded = await Promise.all(options.groups.filter((group) => group.weight > 0 && activeLoves(group.loves).length).map(async (group) => ({
      weight: group.weight, field: personField(state, await loadPersonMaps(state.city, group.loves), tags, local),
    })));
    const groups = loaded.filter((group) => [...group.field.scores.values()].some((score) => score > 0));
    const total = groups.reduce((sum, group) => sum + group.weight, 0);
    if (total) for (const cell of local) you.scores.set(cell.h, groups.reduce((sum, group) => sum + group.weight * (group.field.scores.get(cell.h) ?? 0), 0) / total);
  }
  const them = theirs ? personField(state, theirs, tags, local) : undefined;
  const cells = local.map((cell) => ({ h: cell.h, lat: cell.lat, lon: cell.lon, you: you.scores.get(cell.h) ?? 0,
    ...(them ? { them: them.scores.get(cell.h) ?? 0, both: Math.min(you.scores.get(cell.h) ?? 0, them.scores.get(cell.h) ?? 0) } : {}),
    popularity: cell.popularity, drivers: you.drivers.get(cell.h) ?? {} }));
  if (!cells.some((cell) => cell.you > 0 || (cell.them ?? 0) > 0))
    throw apiError("not_found", `No geographic taste signal found near ${state.city}. Try other loves or a place refinement.`);
  return { city: state.city, center,
    bbox: [Math.min(...cells.map((cell) => cell.lon)), Math.min(...cells.map((cell) => cell.lat)), Math.max(...cells.map((cell) => cell.lon)), Math.max(...cells.map((cell) => cell.lat))],
    cells, sparse: cells.length < 40, signalsWithoutGeo: [...new Set([...you.missing, ...(them?.missing ?? [])])] };
}
