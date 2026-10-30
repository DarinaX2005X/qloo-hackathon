import { activeLoves, apiError } from "@/shared/contracts";
import type { AreaDecision, AreaIdentity, Constraint, EvidenceRef, HomeMatchV2, HomeRequestV2, HomeResponseV2, PlaceV2, SourceAreaV2, SourceSignatureSummary, Support, VenueEvidence } from "@/shared/contracts-09";
import { geocode } from "@/server/geo/geocode";
import { qlooRead, record, records, resultRows, string } from "@/server/qloo/client";
import { haversine, percentileRanks } from "../geo";
import { AREA_CARD_VERSION, DerivedCache, effectiveConstraints, evidenceRef, hash, mapLimit, normalized, resultMeta, uniqueEvidence } from "./core";
import { areaMembership, pointInArea } from "./geometry";
import { brandKey, dedupePlaces, rowPlace, venueEligibility, venueKey } from "./eligibility";
import { canonicalAreaId, cityManifest, NEUTRAL_FAMILIES, type CityManifest, type ManifestArea } from "./manifest";
import { analyzeAreas, neutralVenueEvidence } from "./ranking";
import { anchorOwner, areaCardCopy, assignAreaVenues, pickAnchors } from "./area-cards";
import { areaSignature, MUSIC_SIGNATURE_ENABLED, SIGNATURE_METHOD, placeStyleFeatures, signatureReference, signatureSimilarity, signatureVectors, targetSignatures, type AreaSignature, type SignatureReference } from "./signatures";

const homeCache = new DerivedCache<Omit<HomeResponseV2, "meta">>(60, undefined, `home:${SIGNATURE_METHOD}:${AREA_CARD_VERSION}`);
export async function resolveSourceSignature(source: SourceAreaV2): Promise<AreaSignature> {
  const { value: manifest } = await cityManifest(source.city);
  const existing = source.areaId ? manifest.areas.find(a => a.identity.id === source.areaId)
    : manifest.areas.find(a => [a.identity.name, ...a.identity.aliases].some(n => normalized(n) === normalized(source.neighborhood)));
  if (source.areaId && !existing) throw apiError("not_found", "The source area is no longer in this city catalog. Select it again.");
  if (existing && (!source.point || haversine(source.point, existing.identity.center) < 10)) return areaSignature(manifest, existing);
  const found = source.point ? null : await geocode(`${source.neighborhood}, ${source.city}`, manifest.center, 30000);
  const center = source.point ?? found?.center;
  if (!center || haversine(center, manifest.center) > 30000) throw apiError("not_found", `We couldn't locate ${source.neighborhood} near ${manifest.cityName}. Choose a point or a more specific area.`);
  const identity: AreaIdentity = { id: `${canonicalAreaId(manifest.cityId, source.neighborhood)}:${hash(center).slice(0, 8)}`, name: source.neighborhood, aliases: [source.neighborhood], center, geometry: { kind: "circle", radiusM: 650 }, geometryQuality: "approximate" };
  const evidence: EvidenceRef[] = [...manifest.evidence, evidenceRef(found ? "geocode" : "derived", { fetchedAt: new Date().toISOString(), requestHash: hash([source, center]) })];
  const batches = await mapLimit(Object.values(NEUTRAL_FAMILIES), 3, async tags => {
    try {
      const read = await qlooRead("/v2/insights", { "filter.type": "urn:entity:place", "filter.location": `POINT(${center[0]} ${center[1]})`, "filter.location.radius": 650, "filter.tags": tags.join(","), "operator.filter.tags": "union", take: 25 });
      const rows = resultRows(read.value, "entities");
      evidence.push(evidenceRef("qloo_entity", read, rows.flatMap(row => string(row.entity_id) ?? []))); return rows;
    } catch { return []; }
  });
  const local = batches.flat().flatMap(row => rowPlace(row) ?? []).filter(p => pointInArea([p.lon, p.lat], identity));
  const catalog = dedupePlaces([...manifest.catalog.filter(p => pointInArea([p.lon, p.lat], identity)), ...local]);
  const area: ManifestArea = { identity, cells: areaMembership(identity, center, 650), venueIds: catalog.map(p => p.id), neutralScore: 0 };
  const scoped: CityManifest = { ...manifest, version: `${manifest.version}:source:${hash([identity, catalog.map(p => p.id)])}`, catalog, rows: batches.flat(), evidence, areas: [area] };
  return areaSignature(scoped, area);
}
export function signatureVenueEvidence(signature: AreaSignature, constraints: Constraint[] = []): VenueEvidence[] {
  return signature.places.flatMap(place => {
    const eligible = venueEligibility(place, "daily_life", constraints, { center: signature.area.identity.center, radiusM: 650 });
    if (!eligible.allowed || !eligible.role) return [];
    return [{ place, role: eligible.role, venueKey: venueKey(place), brandKey: brandKey(place), insideArea: true, eligibility: "eligible" as const,
      priceStatus: eligible.priceStatus, hoursStatus: eligible.hoursStatus, connections: [], limitations: eligible.limitations,
      evidenceIds: signature.evidence.filter(e => !e.entityIds || e.entityIds.includes(place.id)).map(e => e.id) }];
  });
}
export function homeMethod(source: Pick<AreaSignature, "style" | "music">, reference: SignatureReference): HomeMatchV2["similarity"]["method"] {
  return MUSIC_SIGNATURE_ENABLED && signatureVectors(source, reference).music.size ? "style_music_v1" : "style_only_v1";
}
export function sourceSummary(source: AreaSignature, reference: SignatureReference, method: HomeMatchV2["similarity"]["method"]): SourceSignatureSummary {
  const vectors = signatureVectors(source, reference);
  const features = (["style", "music"] as const).flatMap(family => source[family].map(f => ({ tagId: f.id, label: f.label, family: family === "style" ? "placeStyle" as const : "musicTaste" as const, weight: vectors[family].get(f.id) ?? 0 }))).filter(f => f.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 20);
  const representatives = signatureVenueEvidence(source).filter(v => source.representatives.some(p => p.id === v.place.id));
  return { area: source.area.identity, cityId: source.manifest.cityId, cityName: source.manifest.cityName, referenceVersion: reference.version, method,
    support: source.quality, venueCount: source.places.length, categoryCounts: source.categoryCounts, missingFamilies: source.missingFamilies, representatives, features, evidenceIds: source.evidence.map(e => e.id) };
}
export function sharedFeatures(source: Pick<AreaSignature, "style" | "music"> & Partial<Pick<AreaSignature, "evidence">>, target: AreaSignature, reference: SignatureReference): HomeMatchV2["sharedFeatures"] {
  const a = signatureVectors(source, reference), b = signatureVectors(target, reference);
  const shared = (["style", "music"] as const).flatMap(family => target[family].filter(f => a[family].has(f.id) && b[family].has(f.id)).map(f => ({ tagId: f.id, label: f.label, weight: Math.min(a[family].get(f.id)!, b[family].get(f.id)!), evidenceIds: uniqueEvidence([...(source.evidence ?? []), ...target.evidence]).map(e => e.id) })))
    .sort((x, y) => y.weight - x.weight || x.tagId.localeCompare(y.tagId));
  const labels = new Set<string>();
  return shared.filter(f => { const label = normalized(f.label); if (labels.has(label)) return false; labels.add(label); return true; }).slice(0, 6).map(f => ({ tagId: f.tagId, label: f.label, evidenceIds: f.evidenceIds }));
}
export function homeAreaDecision(signature: AreaSignature, value: number | null, rank: number, candidateCount: number, constraints: Constraint[] = [], context?: { owned: Map<string, VenueEvidence[]>; neutralByArea: Map<string, VenueEvidence[]>; citySample: PlaceV2[] }): AreaDecision {
  const identities = signature.manifest.areas.map(area => area.identity);
  const owned = context?.owned ?? assignAreaVenues(identities, signatureVenueEvidence(signature, constraints));
  const neutralByArea = context?.neutralByArea ?? assignAreaVenues(identities, signature.manifest.areas.flatMap(area => neutralVenueEvidence(signature.manifest, area, constraints)));
  const pool = owned.get(signature.area.identity.id) ?? [];
  const anchors = pickAnchors(pool);
  const categoryCount = new Set(anchors.map(v => v.role)).size;
  const support: Support = { quality: value === null ? "limited" : signature.quality, activeLoveWeightCovered: 0, observedAreaShare: 0, spatialBlocks: 0,
    eligibleVenueCount: pool.length, categoryCount: new Set(pool.map(v => v.role)).size, missingSignals: [],
    notes: ["Home rank compares area cultural profiles. This is an approximate 650 m area.", ...(value === null ? ["There are too few comparable cultural features or everyday categories for a numeric overlap."] : [])] };
  const copy = areaCardCopy({ area: signature.area.identity, anchors, ownedVenues: pool, citySample: context?.citySample ?? signature.manifest.catalog.filter(place => venueEligibility(place, "daily_life", constraints).allowed), neutralByArea });
  return { area: signature.area.identity, metrics: { tasteScore: .5, rank, candidateCount, percentile: null, tieBand: false, support }, recommendationStatus: value !== null && value >= 35 && signature.quality === "sufficient" && anchors.length >= 3 && categoryCount >= 2 ? "recommended" : "needs_checking",
    headline: copy.headline, tradeoff: `${value === null ? "Too little data to score cultural overlap. " : value < 35 ? "Cultural overlap is weak. " : ""}${copy.tradeoff}`,
    anchors, evidenceIds: [...new Set([...signature.evidence.map(e => e.id), ...signature.manifest.evidence.map(e => e.id), ...anchors.flatMap(v => v.evidenceIds)])] };
}
export function matchSignatures(source: Pick<AreaSignature, "style" | "music" | "quality">, targets: AreaSignature[], reference: SignatureReference, method: HomeMatchV2["similarity"]["method"], constraints: Constraint[] = []): HomeMatchV2[] {
  const scored = targets.map(signature => ({ signature, value: source.quality === "sufficient" ? signatureSimilarity(source, signature, reference, method) : null }));
  scored.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.signature.area.identity.id.localeCompare(b.signature.area.identity.id));
  const manifest = targets[0]?.manifest;
  const identities = manifest?.areas.map(area => area.identity) ?? [];
  const context = { owned: assignAreaVenues(identities, targets.flatMap(signature => signatureVenueEvidence(signature, constraints))),
    neutralByArea: assignAreaVenues(identities, manifest?.areas.flatMap(area => neutralVenueEvidence(manifest, area, constraints)) ?? []),
    citySample: manifest?.catalog.filter(place => venueEligibility(place, "daily_life", constraints).allowed) ?? [] };
  return scored.map(({ signature, value }, index) => {
    const area = homeAreaDecision(signature, value, index + 1, scored.length, constraints, context);
    area.metrics.tieBand = value !== null && scored.some(other => other.signature !== signature && other.value !== null && Math.abs(other.value - value) <= 1);
    return { area, similarity: { value, method, referenceVersion: reference.version, support: value === null ? "limited" : signature.quality }, orderReason: "home_similarity", sharedFeatures: sharedFeatures(source, signature, reference), counterparts: [] };
  });
}
async function oneCounterpart(source: AreaSignature, target: AreaSignature, constraints: Constraint[]): Promise<{ pair: HomeMatchV2["counterparts"]; evidence: EvidenceRef[] }> {
  for (const origin of source.representatives) {
    const role = venueEligibility(origin, "daily_life").role;
    const tags = new Set(placeStyleFeatures(origin).map(t => t.id));
    const candidates = signatureVenueEvidence(target, constraints).filter(v => anchorOwner(v.place, target.manifest.areas.map(a => a.identity)) === target.area.identity.id && v.role === role && v.place.id !== origin.id && placeStyleFeatures(v.place).some(t => tags.has(t.id))).slice(0, 10);
    if (!candidates.length) continue;
    try {
      const read = await qlooRead("/v2/insights", { "filter.type": "urn:entity:place", "filter.results.entities": candidates.map(v => v.place.id).join(","), "signal.interests.entities": origin.id, "feature.explainability": "true", take: Math.min(10, candidates.length) });
      const evidence = [evidenceRef("qloo_explainability", read, [origin.id])];
      const rows = resultRows(read.value, "entities").filter(r => typeof record(r.query).affinity === "number" && Number(record(r.query).affinity) > 0).sort((a, b) => Number(record(b.query).affinity) - Number(record(a.query).affinity));
      const row = rows.find(r => candidates.some(v => v.place.id === r.entity_id));
      const venue = candidates.find(v => v.place.id === row?.entity_id);
      if (!row || !venue) return { pair: [], evidence };
      const contribution = records(record(record(row.query).explainability)["signal.interests.entities"]).find(c => c.entity_id === origin.id);
      const sharedTagIds = placeStyleFeatures(venue.place).filter(t => tags.has(t.id)).map(t => t.id);
      const targetVenue: VenueEvidence = { ...venue, connections: [{ placeId: venue.place.id, loveId: origin.id, ...(typeof contribution?.score === "number" ? { providerContribution: contribution.score } : {}), sharedTagIds, explanationKind: "provider", evidenceIds: evidence.map(e => e.id) }], evidenceIds: [...venue.evidenceIds, ...evidence.map(e => e.id)] };
      return { pair: [{ sourcePlaceId: origin.id, target: targetVenue }], evidence };
    } catch { return { pair: [], evidence: [] }; }
  }
  return { pair: [], evidence: [] };
}
export async function homeV2(input: HomeRequestV2, onProgress?: (result: HomeResponseV2) => void): Promise<HomeResponseV2> {
  if (input.lambda > 0 && !activeLoves(input.state.loves).length) throw apiError("bad_input", "Add a resolved love before combining home with your own tastes, or use home similarity alone.");
  const [source, target, reference] = await Promise.all([resolveSourceSignature(input.source), cityManifest(input.state.city), signatureReference()]);
  const constraints = effectiveConstraints(input.state, input.constraints);
  const method = homeMethod(source, reference);
  const key = hash([source.manifest.version, source.area.identity, target.value.version, reference.version, method, input.lambda, input.state, input.constraints]);
  const cached = await homeCache.get(key, async () => {
    const targets = await targetSignatures(target.value, reference);
    let matches = matchSignatures(source, targets, reference, method, constraints);
    let field: HomeResponseV2["field"];
    const evidence = uniqueEvidence([...source.evidence, ...targets.flatMap(t => t.evidence), ...reference.evidence]);
    if (input.lambda > 0 && activeLoves(input.state.loves).length) {
      const personal = await analyzeAreas(input);
      if (personal) {
        const sRanks = percentileRanks(matches.map(m => m.similarity.value ?? 0));
        const h = matches.map(m => personal.value.areas.find(a => a.area.id === m.area.area.id)?.metrics.tasteScore ?? .5);
        const hRanks = percentileRanks(h);
        const blended = matches.map((m, i) => ({ m, score: (1 - input.lambda) * sRanks[i] + input.lambda * hRanks[i] }));
        matches = blended.sort((a, b) => b.score - a.score || a.m.area.area.id.localeCompare(b.m.area.area.id)).map(({ m }, i) => ({ ...m, area: { ...m.area, metrics: { ...m.area.metrics, rank: i + 1, tasteScore: personal.value.areas.find(a => a.area.id === m.area.area.id)?.metrics.tasteScore ?? .5 } }, orderReason: "home_personal_blend", blendedRank: i + 1 }));
        field = personal.value.field; evidence.push(...personal.value.evidence);
      }
    }
    const first = matches[0], signature = first && targets.find(t => t.area.identity.id === first.area.area.id);
    if (first && onProgress) onProgress(structuredClone({ sourceSignatureSummary: sourceSummary(source, reference, method), matches, ...(field ? { field } : {}), evidence: uniqueEvidence(evidence),
      meta: resultMeta(input, target.value, { method: `home-${method}`, referenceVersion: reference.version, partial: true,
        suffix: [source.area.identity.id, source.manifest.version, input.lambda], dataAsOf: evidence.map(e => e.fetchedAt).sort()[0] }) }));
    if (first && signature && first.similarity.value !== null) {
      const counterpart = await oneCounterpart(source, signature, constraints); first.counterparts = counterpart.pair; evidence.push(...counterpart.evidence);
    }
    return { sourceSignatureSummary: sourceSummary(source, reference, method), matches, ...(field ? { field } : {}), evidence: uniqueEvidence(evidence) };
  });
  const payload = structuredClone(cached.value);
  if (source.unavailable || source.musicStatus === "unavailable" || payload.matches.some(m => m.similarity.value === null)) homeCache.delete(key);
  const partial = !reference.complete || source.quality !== "sufficient" || payload.matches.slice(0, 3).some(m => m.similarity.value === null || m.area.recommendationStatus !== "recommended");
  return { ...payload, meta: resultMeta(input, target.value, { method: `home-${method}`, referenceVersion: reference.version, hit: cached.hit, partial,
    suffix: [source.area.identity.id, source.manifest.version, input.lambda], dataAsOf: payload.evidence.map(e => e.fetchedAt).sort()[0] }) };
}
