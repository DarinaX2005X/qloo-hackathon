import { activeLoves, DOMAINS, type Domain, type ExploreState, type ResolvedLove, type TasteField, apiError } from "@/shared/contracts";
import { qlooGet, record, resultRows, string, number, unit, type QlooRecord } from "@/server/qloo/client";
import { signals } from "./signals";
import { mean } from "./geo";

export type HeatCell = { h: string; lat: number; lon: number; affinity: number; popularity: number; affinities: Partial<Record<Domain, number>> };
export type PersonField = { cells: Map<string, { cell: HeatCell; score: number; drivers: Record<string, number> }>; missing: string[] };

export function heatCell(row: QlooRecord): HeatCell | null {
  const location = record(row.location);
  const query = record(row.query);
  const h = string(location.geohash);
  const lat = number(location.latitude, NaN);
  const lon = number(location.longitude, NaN);
  if (!h || h.length !== 6 || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const affinities: HeatCell["affinities"] = {};
  for (const domain of DOMAINS) {
    const value = query[`entity_${domain}_affinity`];
    if (typeof value === "number" && Number.isFinite(value)) affinities[domain] = unit(value);
  }
  return { h, lat, lon, affinity: unit(query.affinity), popularity: unit(query.popularity), affinities };
}

export async function heatmap(city: string, loves: ResolvedLove[], tagId?: string): Promise<HeatCell[]> {
  const signal = tagId ? { "signal.interests.tags": tagId } : signals(loves);
  if (!tagId && !activeLoves(loves).length) return [];
  const response = await qlooGet("/v2/insights", {
    "filter.type": "urn:heatmap", "filter.location.query": city, ...signal, take: 50,
  });
  return resultRows(response, "heatmap").map(heatCell).filter((cell): cell is HeatCell => cell !== null);
}

/** Domain weights aggregate the weights of active loves in that domain. */
export function weightedCell(cell: HeatCell, loves: ResolvedLove[]): { score: number; drivers: Record<string, number> } {
  const weights = new Map<Domain, number>();
  for (const love of activeLoves(loves)) weights.set(love.chosen.domain, (weights.get(love.chosen.domain) ?? 0) + love.weight);
  let denominator = 0;
  const contributions: Record<string, number> = {};
  for (const [domain, weight] of weights) {
    const affinity = cell.affinities[domain];
    if (affinity === undefined) continue;
    denominator += weight;
    contributions[domain] = weight * affinity;
  }
  const total = Object.values(contributions).reduce((sum, n) => sum + n, 0);
  return { score: denominator ? total / denominator : cell.affinity,
    drivers: Object.fromEntries(Object.entries(contributions).map(([domain, n]) => [domain, total ? n / total : 0])) };
}

export async function personField(state: ExploreState, loves: ResolvedLove[], tags: HeatCell[][]): Promise<PersonField> {
  const base = await heatmap(state.city, loves);
  // Probe only domains not represented in the combined response; never infer no-geo from popularity.
  const uncertain = activeLoves(loves).filter((love) => !base.some((cell) => (cell.affinities[love.chosen.domain] ?? 0) > 0));
  const checks = await Promise.all(uncertain.map(async (love) => ({ love, cells: await heatmap(state.city, [love]) })));
  const missing = checks.filter(({ cells }) => !cells.some((cell) => cell.affinity > 0)).map(({ love }) => love.query);
  const usable = loves.filter((love) => !missing.includes(love.query));
  const bases = new Map(base.map((cell) => [cell.h, cell]));
  // A mixed Qloo query can be empty even when an individual signal is usable.
  if (!base.length) for (const { cells } of checks) for (const cell of cells) bases.set(cell.h, cell);
  const tagMaps = tags.filter((cells) => cells.length).map((cells) => new Map(cells.map((cell) => [cell.h, cell])));
  const all = new Map(bases);
  for (const map of tagMaps) for (const [h, cell] of map) if (!all.has(h)) all.set(h, cell);
  const cells: PersonField["cells"] = new Map();
  let max = 0;
  for (const [h, cell] of all) {
    const weighted = bases.has(h) ? weightedCell(bases.get(h)!, usable) : { score: 0, drivers: {} };
    const tagAffinity = mean(tagMaps.map((map) => map.get(h)?.affinity ?? 0));
    const refined = tagMaps.length ? (bases.size ? 0.65 * weighted.score + 0.35 * tagAffinity : tagAffinity) : weighted.score;
    const score = refined * (1 - 0.7 * state.discovery * cell.popularity);
    cells.set(h, { cell, score, drivers: weighted.drivers });
    max = Math.max(max, score);
  }
  if (max) for (const item of cells.values()) item.score /= max;
  return { cells, missing };
}

export async function buildField(state: ExploreState): Promise<TasteField> {
  const tags = await Promise.all(state.refinements.map((tag) => heatmap(state.city, [], tag.id)));
  const [you, them] = await Promise.all([
    personField(state, state.loves, tags),
    state.companion ? personField(state, state.companion.loves, tags) : undefined,
  ]);
  const hashes = new Set([...you.cells.keys(), ...(them?.cells.keys() ?? [])]);
  const cells = [...hashes].sort().map((h) => {
    const yours = you.cells.get(h);
    const theirs = them?.cells.get(h);
    const cell = (yours ?? theirs)!.cell;
    return { h, lat: cell.lat, lon: cell.lon, you: yours?.score ?? 0,
      ...(them ? { them: theirs?.score ?? 0, both: Math.min(yours?.score ?? 0, theirs?.score ?? 0) } : {}),
      popularity: cell.popularity, drivers: yours?.drivers ?? {} };
  });
  const nonzero = cells.filter((cell) => cell.you > 0 || (cell.them ?? 0) > 0);
  if (!nonzero.length) throw apiError("not_found", `No geographic taste signal found for ${state.city}. Try other loves or a place refinement.`);
  const sorted = [...nonzero].sort((a, b) => (b.both ?? b.you) - (a.both ?? a.you));
  const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.2)));
  const scores = top.map((cell) => cell.both ?? cell.you);
  const sum = scores.reduce((a, b) => a + b, 0);
  const center: [number, number] = sum
    ? [top.reduce((n, cell, i) => n + cell.lon * scores[i], 0) / sum, top.reduce((n, cell, i) => n + cell.lat * scores[i], 0) / sum]
    : [mean(top.map((cell) => cell.lon)), mean(top.map((cell) => cell.lat))];
  return { city: state.city, center,
    bbox: [Math.min(...nonzero.map((cell) => cell.lon)), Math.min(...nonzero.map((cell) => cell.lat)), Math.max(...nonzero.map((cell) => cell.lon)), Math.max(...nonzero.map((cell) => cell.lat))],
    cells, sparse: cells.length < 40, signalsWithoutGeo: [...new Set([...you.missing, ...(them?.missing ?? [])])] };
}
