import { activeLoves, apiError, type ExploreState, type ResolvedLove } from "@/shared/contracts";
import type { AnalysisRequestV2, AreaDecision, AreaMetrics, Constraint, EvidenceRef, Support, TasteFieldV2, VenueEvidence } from "@/shared/contracts-09";
import { qlooRead, record, resultRows, string, type QlooRecord } from "@/server/qloo/client";
import { haversine, median, percentileRanks } from "../geo";
import { cityCenter } from "../city";
import { foldCells, heatCell, type HeatCell } from "../field";
import { AREA_CARD_VERSION, DerivedCache, DAY_TTL, effectiveConstraints, evidenceRef, hash, METHOD_VERSION, NATIVE_METHOD_VERSION, profileHash, RANKING_GATE_PASSED, uniqueEvidence } from "./core";
import { brandKey, intentRole, rowPlace, venueEligibility, venueKey } from "./eligibility";
import { areaCardCopy, assignAreaVenues, leadingConnection, pickAnchors } from "./area-cards";
export { pickAnchors } from "./area-cards";
import { geohashBounds, pointInArea } from "./geometry";
import { cityManifest, NEUTRAL_FAMILIES, type CityManifest, type ManifestArea } from "./manifest";
import { coarseSignalRanks, CONTEXT_RADIUS_M, scoreContext, type CoarseSignalCell } from "./context-ranking";

export type NativeCell = { h: string; lon: number; lat: number; value: number; affinity: number; popularity: number; kind: "affinity_rank" | "affinity" };
export type NativeSignal = { entityId: string; status: "ok" | "no_signal" | "unavailable"; cells: NativeCell[]; contextCells?: CoarseSignalCell[]; evidence: EvidenceRef[] };
export type WeightedSignal = NativeSignal & { query: string; weight: number; domain: string; ranks: Map<string, number>; contextRanks?: Map<string, number> };
export type Analysis = { manifest: CityManifest; discovery: number; field: TasteFieldV2; areas: AreaDecision[]; yours: WeightedSignal[]; theirs: WeightedSignal[] | null; support: Support; evidence: EvidenceRef[]; generatedAt: string; dataAsOf: string };
const signalsCache = new DerivedCache<NativeSignal>(320, DAY_TTL, `signals:${NATIVE_METHOD_VERSION}`);
const analyses = new DerivedCache<Analysis>(100, undefined, `analyses:${METHOD_VERSION}:${AREA_CARD_VERSION}`);
export function clearAnalysisCache(): void { signalsCache.clear(); analyses.clear(); }

export function nativeCells(rows: QlooRecord[], center: [number, number], radiusM: number): NativeCell[] {
  const found = new Map<string, NativeCell>();
  for (const row of rows) {
    const h = string(record(row.location).geohash);
    if (!h || h.length !== 7) continue;
    const bounds = geohashBounds(h);
    if (!bounds) continue;
    const lon = (bounds[0] + bounds[2]) / 2, lat = (bounds[1] + bounds[3]) / 2;
    if (haversine(center, [lon, lat]) > radiusM) continue;
    const q = record(row.query), rank = q.affinity_rank, affinity = q.affinity;
    const kind = typeof rank === "number" && Number.isFinite(rank) && rank >= 0 && rank <= 1 ? "affinity_rank" : "affinity";
    const value = kind === "affinity_rank" ? rank : affinity;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) continue;
    if (!found.has(h)) found.set(h, { h, lon, lat, value, affinity: typeof affinity === "number" && Number.isFinite(affinity) ? affinity : value, popularity: typeof q.popularity === "number" ? q.popularity : 0, kind });
  }
  return [...found.values()].sort((a, b) => a.h.localeCompare(b.h));
}
export async function loadNativeSignal(manifest: CityManifest, entityId: string): Promise<NativeSignal> {
  // Transport failures never enter the daily cache as successful empty signals.
  try {
    return (await signalsCache.get(hash([manifest.version, entityId]), async () => {
      const context = !RANKING_GATE_PASSED && !!manifest.contextCells;
      const center = context ? await cityCenter(manifest.cityName) : manifest.center;
      const read = await qlooRead("/v2/insights", { "filter.type": "urn:heatmap", "filter.location": `POINT(${center[0]} ${center[1]})`, "filter.location.radius": context ? 15000 : manifest.radiusM, "signal.interests.entities": entityId, take: 50 });
      const rows = resultRows(read.value, "heatmap"), cells = nativeCells(rows, manifest.center, manifest.radiusM);
      const retained = new Set(manifest.contextCells?.map(c => c.h));
      const contextCells = context ? foldCells(rows.map(heatCell).filter((cell): cell is HeatCell => !!cell)).filter(c => retained.has(c.h)).map(c => ({ h: c.h, affinity: c.affinity, popularity: c.popularity })) : undefined;
      const hasSignal = contextCells ? contextCells.some(c => c.affinity > 0) : cells.length > 0;
      return { entityId, status: hasSignal ? "ok" as const : "no_signal" as const, cells, ...(contextCells ? { contextCells } : {}), evidence: [evidenceRef("qloo_heatmap", read, [entityId], NATIVE_METHOD_VERSION)] };
    })).value;
  } catch { return { entityId, status: "unavailable", cells: [], evidence: [] }; }
}
export async function weightedSignals(manifest: CityManifest, loves: ResolvedLove[]): Promise<WeightedSignal[]> {
  const unique = [...new Map(activeLoves(loves).map(love => [love.chosen.id, love])).values()];
  return Promise.all(unique.map(async love => {
    const signal = await loadNativeSignal(manifest, love.chosen.id);
    if (signal.contextCells) {
      const contextRanks = coarseSignalRanks(signal.contextCells);
      return { ...signal, query: love.query, domain: love.chosen.domain, weight: love.weight, contextRanks,
        ranks: new Map(signal.cells.flatMap(cell => contextRanks.has(cell.h.slice(0, 6)) ? [[cell.h, contextRanks.get(cell.h.slice(0, 6))!] as const] : [])) };
    }
    const ranks = rankingSignalValues(signal.cells);
    return { ...signal, query: love.query, domain: love.chosen.domain, weight: love.weight, ranks: new Map(signal.cells.map((cell, i) => [cell.h, ranks[i]])) };
  }));
}
export function rankingSignalValues(cells: NativeCell[], native = RANKING_GATE_PASSED): number[] {
  if (native) return percentileRanks(cells.map(c => c.value));
  // Legacy stabilized ratio on a FIXED native grid. This is an engineering heuristic,
  // not a population adjustment; no city coefficients, crowd discounts or score inflation.
  const prior = Math.max(.02, median(cells.map(c => c.popularity)));
  return percentileRanks(cells.map(c => (c.affinity + prior) / (c.popularity + prior)));
}
export function scorePerson(area: ManifestArea, signals: WeightedSignal[], discovery = .35): { score: number; support: Support } {
  if (area.contextCells && signals.some(signal => signal.contextRanks)) return scoreContext(area.contextCells, signals, discovery);
  const usable = signals.filter(s => s.status === "ok" && s.weight > 0);
  const allWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const usableWeight = usable.reduce((sum, s) => sum + s.weight, 0);
  const surveyed = area.cells.reduce((sum, c) => sum + c.areaM2, 0);
  const observed = new Set<string>(), blocks = new Set<string>();
  let coveredWeight = 0, score = 0;
  for (const signal of usable) {
    const local = area.cells.filter(c => signal.ranks.has(c.h));
    const localArea = local.reduce((sum, c) => sum + c.areaM2, 0);
    const coverage = surveyed ? localArea / surveyed : 0;
    const localBlocks = new Set(local.map(c => c.block)).size;
    if (local.length) coveredWeight += signal.weight;
    for (const cell of local) { observed.add(cell.h); blocks.add(cell.block); }
    const meanRank = localArea ? local.reduce((sum, c) => sum + c.areaM2 * signal.ranks.get(c.h)!, 0) / localArea : 0.5;
    const reliability = Math.min(1, coverage / 0.6) * localBlocks / (localBlocks + 3);
    score += signal.weight / usableWeight * (0.5 + reliability * (meanRank - 0.5));
  }
  const observedAreaShare = surveyed ? area.cells.filter(c => observed.has(c.h)).reduce((sum, c) => sum + c.areaM2, 0) / surveyed : 0;
  const activeLoveWeightCovered = allWeight ? coveredWeight / allWeight : 0;
  const quality = !usable.length ? "unavailable" : activeLoveWeightCovered >= 0.5 && blocks.size >= 3 && observedAreaShare >= 0.25 ? "sufficient" : "limited";
  return { score: usableWeight ? score : 0.5, support: { quality, activeLoveWeightCovered, observedAreaShare: Math.min(1, observedAreaShare), spatialBlocks: blocks.size, eligibleVenueCount: 0, categoryCount: 0,
    missingSignals: signals.filter(s => s.status !== "ok").map(s => ({ query: s.query, reason: s.status as "no_signal" | "unavailable" })),
    notes: quality === "sufficient" ? [] : ["The observed cultural signal does not cover enough of this area for a confident comparison."] } };
}
export function orderMetrics(manifest: CityManifest, yours: WeightedSignal[], theirs: WeightedSignal[] | null, discovery = .35): Map<string, AreaMetrics> {
  const scores = manifest.areas.map(area => ({ id: area.identity.id, context: area.contextCells, you: scorePerson(area, yours, discovery), them: theirs ? scorePerson(area, theirs, discovery) : null }));
  const yourOrder = [...scores].sort((a, b) => b.you.score - a.you.score || a.id.localeCompare(b.id));
  const theirOrder = [...scores].sort((a, b) => (b.them?.score ?? 0) - (a.them?.score ?? 0) || a.id.localeCompare(b.id));
  const score = (item: typeof scores[number]) => item.them ? Math.min(item.you.score, item.them.score) : item.you.score;
  const ordered = [...scores].sort((a, b) => score(b) - score(a) || ((b.you.score + (b.them?.score ?? 0)) - (a.you.score + (a.them?.score ?? 0))) || a.id.localeCompare(b.id));
  const supported = ordered.filter(a => a.you.support.quality === "sufficient" && (!a.them || a.them.support.quality === "sufficient"));
  const noClearLeader = supported.length < 5 || Math.max(...supported.map(score)) - median(supported.map(score)) < .02;
  return new Map(ordered.map((item, index) => {
    const value = score(item), supports = [item.you.support, ...(item.them ? [item.them.support] : [])];
    const support: Support = { ...item.you.support,
      quality: supports.some(s => s.quality === "unavailable") ? "unavailable" : supports.every(s => s.quality === "sufficient") ? "sufficient" : "limited",
      activeLoveWeightCovered: Math.min(...supports.map(s => s.activeLoveWeightCovered)), observedAreaShare: Math.min(...supports.map(s => s.observedAreaShare)), spatialBlocks: Math.min(...supports.map(s => s.spatialBlocks)),
      missingSignals: supports.flatMap(s => s.missingSignals), notes: [...new Set(supports.flatMap(s => s.notes))] };
    const tieBand = noClearLeader || ordered.some(other => other.id !== item.id && Math.abs(score(other) - value) <= 0.01);
    const percentile = RANKING_GATE_PASSED && support.quality === "sufficient" && supported.length >= 5 && !noClearLeader
      ? 100 * (supported.filter(other => score(other) < value - .01).length + .5 * supported.filter(other => Math.abs(score(other) - value) <= .01).length) / supported.length : null;
    return [item.id, { tasteScore: value, rank: index + 1, candidateCount: ordered.length, percentileCandidateCount: supported.length, percentile, tieBand, support,
      ...(item.context ? { rankingContext: { kind: "fixed_nearest_cells" as const, cellPrecision: 6 as const, radiusM: CONTEXT_RADIUS_M, cellCount: item.context.length, observedCellCount: support.spatialBlocks } } : {}),
      ...(item.them ? { you: { score: item.you.score, rank: yourOrder.findIndex(a => a.id === item.id) + 1, support: item.you.support }, partner: { score: item.them.score, rank: theirOrder.findIndex(a => a.id === item.id) + 1, support: item.them.support } } : {}) }];
  }));
}
export function buildNativeField(manifest: CityManifest, yours: WeightedSignal[], theirs: WeightedSignal[] | null, discovery = .35): TasteFieldV2 {
  const all = [...yours, ...(theirs ?? [])];
  const geometry = new Map(all.flatMap(s => s.cells).map(c => [c.h, c]));
  const kindsAt = new Map<string, Set<NativeCell["kind"]>>();
  for (const signal of all) for (const cell of signal.cells) {
    const set = kindsAt.get(cell.h) ?? new Set<NativeCell["kind"]>(); set.add(cell.kind); kindsAt.set(cell.h, set);
  }
  function valueAt(h: string, signals: WeightedSignal[]) {
    const total = signals.reduce((sum, s) => sum + s.weight, 0), observed = signals.filter(s => s.ranks.has(h));
    const weight = observed.reduce((sum, s) => sum + s.weight, 0);
    const context = signals.some(s => s.contextRanks);
    let score = weight ? observed.reduce((sum, s) => sum + s.weight * s.ranks.get(h)!, 0) / (context ? total : weight) : .5;
    if (context && weight) {
      const observedPopularity = observed.flatMap(s => { const c = s.contextCells?.find(c => c.h === h.slice(0, 6)); return c ? [{ weight: s.weight, value: c.popularity }] : []; });
      const popWeight = observedPopularity.reduce((sum, item) => sum + item.weight, 0);
      const popularity = popWeight ? observedPopularity.reduce((sum, item) => sum + item.weight * item.value, 0) / popWeight : 0;
      score *= 1 - .7 * discovery * popularity;
    }
    const drivers: Record<string, number> = {};
    for (const s of observed) drivers[s.domain] = (drivers[s.domain] ?? 0) + s.weight / weight;
    return { score, support: total ? weight / total : 0, drivers };
  }
  const cells = [...geometry.values()].sort((a, b) => a.h.localeCompare(b.h)).map(cell => {
    const you = valueAt(cell.h, yours), them = theirs ? valueAt(cell.h, theirs) : null;
    const kinds = kindsAt.get(cell.h)!;
    return { h: cell.h, lon: cell.lon, lat: cell.lat, you: you.score, support: you.support, drivers: you.drivers,
      // Provider popularity remains available for legacy map shading; it is not a population baseline.
      popularity: cell.popularity, signalKind: !RANKING_GATE_PASSED ? "heuristic" as const : kinds.size > 1 ? "mixed" as const : cell.kind,
      ...(them ? { them: them.score, both: Math.min(you.score, them.score), partnerSupport: them.support } : {}) };
  });
  const lat = manifest.radiusM / 111_195, lon = lat / Math.cos(manifest.center[1] * Math.PI / 180);
  return { city: manifest.cityName, center: manifest.center, bbox: [manifest.center[0] - lon, manifest.center[1] - lat, manifest.center[0] + lon, manifest.center[1] + lat], cells,
    sparse: cells.filter(c => c.support >= .5).length < 40, signalsWithoutGeo: all.filter(s => s.status === "no_signal").map(s => s.query) };
}
export function venueFromRow(row: QlooRecord, area: ManifestArea, state: ExploreState, constraints: Constraint[], evidence: EvidenceRef[]): VenueEvidence | null {
  const place = rowPlace(row);
  if (!place) return null;
  const eligibility = venueEligibility(place, "daily_life", constraints, { center: area.identity.center, radiusM: 650 });
  if (!eligibility.allowed || !eligibility.role) return null;
  const allowed = new Set(activeLoves([...state.loves, ...(state.companion?.loves ?? [])]).map(l => l.chosen.id.toUpperCase()));
  const provider = recordsExplainability(row);
  const ids = evidence.map(e => e.id);
  const connections = provider.flatMap(contribution => {
    const loveId = string(contribution.entity_id), score = contribution.score;
    return loveId && allowed.has(loveId.toUpperCase()) && typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1
      ? [{ placeId: place.id, loveId, providerContribution: score, sharedTagIds: [], explanationKind: "provider" as const, evidenceIds: ids }] : [];
  });
  return { place, role: eligibility.role, venueKey: venueKey(place), brandKey: brandKey(place), insideArea: true, eligibility: "eligible", priceStatus: eligibility.priceStatus,
    hoursStatus: eligibility.hoursStatus, connections, limitations: eligibility.limitations, evidenceIds: ids };
}
function recordsExplainability(row: QlooRecord): QlooRecord[] {
  const input = record(record(row.query).explainability)["signal.interests.entities"];
  return Array.isArray(input) ? input.map(record) : [];
}
async function personalizedAnchors(manifest: CityManifest, area: ManifestArea, state: ExploreState, constraints: Constraint[]): Promise<{ venues: VenueEvidence[]; evidence: EvidenceRef[] }> {
  const ids = activeLoves([...state.loves, ...(state.companion?.loves ?? [])]).map(l => l.chosen.id);
  if (!ids.length) return { venues: [], evidence: [] };
  try {
    const read = await qlooRead("/v2/insights", { "filter.type": "urn:entity:place", "filter.location": `POINT(${area.identity.center[0]} ${area.identity.center[1]})`, "filter.location.radius": 650,
      "filter.tags": Object.values(NEUTRAL_FAMILIES).flat().join(","), "operator.filter.tags": "union", "signal.interests.entities": [...new Set(ids)].join(","), "feature.explainability": "true", take: 50 });
    const evidence = [evidenceRef("qloo_entity", read), evidenceRef("qloo_explainability", read, ids)];
    return { venues: resultRows(read.value, "entities").flatMap(row => venueFromRow(row, area, state, constraints, evidence) ?? []), evidence };
  } catch { return { venues: [], evidence: [] }; }
}
export async function analyzeAreas(input: AnalysisRequestV2, onProgress?: (analysis: Analysis) => void): Promise<{ value: Analysis; hit: boolean }> {
  const { value: manifest } = await cityManifest(input.state.city);
  const constraints = effectiveConstraints(input.state, input.constraints);
  if (input.manifestVersion && input.manifestVersion !== manifest.version) throw apiError("bad_input", "The area catalog changed. Refresh the area comparison before continuing.", true);
  const key = hash([profileHash(input.state, input.constraints), manifest.version, METHOD_VERSION]);
  const result = await analyses.get(key, async () => {
    const [yours, theirs] = await Promise.all([weightedSignals(manifest, input.state.loves), input.state.companion ? weightedSignals(manifest, input.state.companion.loves) : null]);
    if (![...yours, ...(theirs ?? [])].some(s => s.status === "ok")) {
      const failed = [...yours, ...(theirs ?? [])].some(s => s.status === "unavailable");
      throw apiError(failed ? "qloo_unavailable" : "not_found", failed ? "The cultural signals could not be retrieved. Retry this comparison." : "These loves have no geographic signal in this city. Try a different love or a neighborhood you know.", failed);
    }
    const field = buildNativeField(manifest, yours, theirs, input.state.discovery);
    const metrics = orderMetrics(manifest, yours, theirs, input.state.discovery);
    const ordered = [...manifest.areas].sort((a, b) => metrics.get(a.identity.id)!.rank - metrics.get(b.identity.id)!.rank);
    const enriching = Promise.all(ordered.slice(0, 3).map(area => personalizedAnchors(manifest, area, input.state, constraints)));
    const identities = manifest.areas.map(area => area.identity);
    const neutral = ordered.flatMap(area => neutralVenueEvidence(manifest, area, constraints));
    const neutralByArea = assignAreaVenues(identities, neutral);
    const citySample = manifest.catalog.filter(place => venueEligibility(place, "daily_life", constraints).allowed);
    const render = (topEvidence: { venues: VenueEvidence[]; evidence: EvidenceRef[] }[]): Analysis => {
    const evidence = uniqueEvidence([...manifest.evidence, ...yours.flatMap(s => s.evidence), ...(theirs?.flatMap(s => s.evidence) ?? []), ...topEvidence.flatMap(e => e.evidence)]);
    const owned = assignAreaVenues(identities, [...topEvidence.flatMap(result => result.venues), ...neutral]);
    const areas: AreaDecision[] = ordered.map(area => {
      const pool = owned.get(area.identity.id)!;
      const picked = pickAnchors(pool), lead = leadingConnection(picked, input.state);
      // Keep the leading proof visible even in the two-place shortlist preview.
      const venues = lead ? [lead.venue, ...picked.filter(v => v.place.id !== lead.venue.place.id)] : picked;
      const m = structuredClone(metrics.get(area.identity.id)!);
      m.support.eligibleVenueCount = pool.length; m.support.categoryCount = new Set(pool.map(v => v.role)).size;
      const recommended = RANKING_GATE_PASSED && m.support.quality === "sufficient" && venues.length >= 3 && m.support.categoryCount >= 2;
      if (!RANKING_GATE_PASSED) m.support.notes.push("The geographic ranking is exploratory. Compare the actual places before choosing an area.");
      if (!recommended) m.support.notes.push("Everyday evidence needs checking before choosing this area.");
      return { area: area.identity, metrics: m, recommendationStatus: recommended ? "recommended" : "needs_checking",
        ...areaCardCopy({ area: area.identity, anchors: venues, ownedVenues: pool, citySample, neutralByArea, state: input.state }),
        anchors: venues, evidenceIds: [...new Set([...manifest.evidence.map(e => e.id), ...yours.flatMap(s => s.evidence.map(e => e.id)), ...venues.flatMap(v => v.evidenceIds)])] };
    });
    const usable = areas.filter(a => a.metrics.support.quality === "sufficient");
    const support: Support = { ...(areas[0]?.metrics.support ?? scorePerson(manifest.areas[0], yours).support),
      quality: usable.length >= 5 ? "sufficient" : "limited", notes: [...manifest.notes, ...(!RANKING_GATE_PASSED ? ["The geographic ranking is exploratory; percentiles are hidden because the native method did not pass the reference gate."] : []), ...(usable.length < 5 ? ["Fewer than five areas have sufficient geographic support; percentiles are hidden."] : [])] };
    return { manifest, discovery: input.state.discovery, field, areas, yours, theirs, support, evidence, generatedAt: new Date().toISOString(), dataAsOf: evidence.map(e => e.fetchedAt).sort()[0] };
    };
    // The rank and neutral venue proof already exist. Do not hold this useful
    // result behind three optional provider-explainability lookups.
    if (onProgress) {
      const initial = render([]);
      if (initial.areas.slice(0, 3).some(area => area.anchors.length)) onProgress(structuredClone(initial));
    }
    return render(await enriching);
  });
  // Callers receive independent objects; local ablation and metadata must never mutate cached results.
  if ([...result.value.yours, ...(result.value.theirs ?? [])].some(s => s.status === "unavailable")) analyses.delete(key);
  return { value: structuredClone(result.value), hit: result.hit };
}

export function withoutLoveMetrics(analysis: Analysis, loveId: string): Map<string, AreaMetrics> | null {
  const signals = analysis.yours.filter(s => s.entityId !== loveId);
  if (!signals.some(s => s.status === "ok")) return null;
  return orderMetrics(analysis.manifest, signals, analysis.theirs, analysis.discovery);
}

/** Used by home/address/visit where neutral proof is appropriate and no taste is claimed. */
export function neutralVenueEvidence(manifest: CityManifest, area: ManifestArea, constraints: Constraint[] = []): VenueEvidence[] {
  const ids = new Set(area.venueIds);
  return manifest.catalog.filter(p => ids.has(p.id) && pointInArea([p.lon, p.lat], area.identity)).flatMap(place => {
    const eligibility = venueEligibility(place, "daily_life", constraints), role = intentRole("daily_life", place);
    return eligibility.allowed && role ? [{ place, role, venueKey: venueKey(place), brandKey: brandKey(place), insideArea: true, eligibility: "eligible" as const,
      priceStatus: eligibility.priceStatus, hoursStatus: eligibility.hoursStatus, connections: [], limitations: eligibility.limitations, evidenceIds: manifest.evidence.filter(e => e.kind === "qloo_entity").map(e => e.id) }] : [];
  });
}
