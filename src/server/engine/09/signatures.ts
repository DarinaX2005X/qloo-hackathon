import type { EvidenceRef, PlaceV2, Quality } from "@/shared/contracts-09";
import { apiError } from "@/shared/contracts";
import { qlooRead, resultRows, string } from "@/server/qloo/client";
import { tagRef } from "@/server/qloo/search";
import { DerivedCache, DAY_TTL, evidenceRef, hash, mapLimit, normalized, uniqueEvidence } from "./core";
import { brandKey, dedupePlaces, intentRole, rowPlace, venueEligibility } from "./eligibility";
import { pointInArea } from "./geometry";
import { cityManifest, NEUTRAL_FAMILIES, type CityManifest, type ManifestArea } from "./manifest";

export const REFERENCE_CITIES = ["Berlin", "Lisbon", "Reykjavík"] as const;
export const SIGNATURE_METHOD = "balanced-area-distinctive-style-v4";
// The preregistered music blend failed the Alfama 20% holdout gate: median 47.4.
// The specified style-only cut passes without changing weights or special-casing identity.
export const MUSIC_SIGNATURE_ENABLED = false;
type Family = "coffee" | "food" | "nightlife" | "culture";
const FAMILIES: Family[] = ["coffee", "food", "nightlife", "culture"];
const GENERIC_STYLE = new Set(["casual", "modern", "charming", "social", "lively", "unique", "fun", "comfortable", "busy", "classy", "welcoming", "relaxing", "cozy", "stylish", "large group", "family friendly", "kid friendly", "child friendly", "good for groups"]);
export type SignatureFeature = { id: string; label: string; tf: number };
export type AreaSignature = {
  area: ManifestArea; manifest: CityManifest; places: PlaceV2[]; representatives: PlaceV2[];
  categoryCounts: Record<string, number>; style: SignatureFeature[]; music: SignatureFeature[];
  quality: Quality; missingFamilies: string[]; evidence: EvidenceRef[]; musicStatus: "ok" | "no_signal" | "unavailable";
  unavailable?: boolean;
};
export type SignatureReference = {
  version: string; cities: string[]; styleIdf: Map<string, number>; musicIdf: Map<string, number>;
  citySignatures: Map<string, AreaSignature[]>; manifests: Map<string, CityManifest>; evidence: EvidenceRef[]; complete: boolean;
};
const signatures = new DerivedCache<AreaSignature>(220, DAY_TTL, `signatures:${SIGNATURE_METHOD}`);
const references = new DerivedCache<SignatureReference>(1, DAY_TTL, `references:${SIGNATURE_METHOD}`);
export function signatureFamily(place: PlaceV2): Family | null {
  const role = intentRole("daily_life", place);
  return role === "bar" || role === "dance" || role === "live_music" ? "nightlife" : role;
}
export function substantiveStyleTag(tag: { id: string; name: string }): boolean {
  if (!/^urn:tag:(?:ambience|decor):/.test(tag.id) && !/(?:cuisine|dining_style)/.test(tag.id)) return false;
  if (GENERIC_STYLE.has(normalized(tag.name))) return false;
  if (/\b(?:large group|group booking|family friendly|kid friendly|child friendly|wheelchair|reservation|service)\b/.test(normalized(tag.id))) return false;
  if (/^urn:tag:(?:ambience|decor):/.test(tag.id)) return true;
  // Cultural style, not countries, general venue types or technical amenities.
  return /(?:cuisine|dining_style)/.test(tag.id) && /\b(?:fusion|farm to table|molecular|experimental|vegan|vegetarian|fine dining|tapas|street food)\b/.test(normalized(tag.name));
}
export function placeStyleFeatures(place: PlaceV2): { id: string; name: string }[] {
  return [...new Map((place.tags ?? []).filter(substantiveStyleTag).map(tag => [tag.id, tag])).values()];
}
export function selectSignaturePlaces(places: PlaceV2[]): PlaceV2[] {
  const sorted = dedupePlaces(places.filter(p => venueEligibility(p, "daily_life").allowed), true)
    .sort((a, b) => placeStyleFeatures(b).length - placeStyleFeatures(a).length || b.popularity - a.popularity || a.id.localeCompare(b.id));
  return FAMILIES.flatMap(family => sorted.filter(p => signatureFamily(p) === family).slice(0, 6));
}
export function signatureRepresentatives(places: PlaceV2[]): PlaceV2[] {
  const sorted = [...places].sort((a, b) => placeStyleFeatures(b).length - placeStyleFeatures(a).length || b.popularity - a.popularity || a.id.localeCompare(b.id));
  const selected: PlaceV2[] = []; let chainUsed = false;
  const add = (p: PlaceV2) => {
    if (selected.some(s => s.id === p.id) || (chainUsed && brandKey(p))) return;
    selected.push(p); if (brandKey(p)) chainUsed = true;
  };
  for (let round = 0; round < 6 && selected.length < 8; round++) for (const family of FAMILIES) {
    const next = sorted.filter(p => signatureFamily(p) === family)[round];
    if (next) add(next);
    if (selected.length === 8) break;
  }
  return selected;
}
export function styleTermFrequency(places: PlaceV2[]): SignatureFeature[] {
  const present = FAMILIES.filter(f => places.some(p => signatureFamily(p) === f));
  const features = new Map<string, SignatureFeature>();
  for (const family of present) {
    const local = places.filter(p => signatureFamily(p) === family);
    for (const place of local) for (const tag of placeStyleFeatures(place)) {
      const feature = features.get(tag.id) ?? { id: tag.id, label: tag.name, tf: 0 };
      feature.tf += 1 / local.length / present.length; features.set(tag.id, feature);
    }
  }
  return [...features.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function signatureSupport(places: PlaceV2[]): { quality: Quality; categoryCounts: Record<string, number> } {
  const categoryCounts = Object.fromEntries(FAMILIES.map(f => [f, places.filter(p => signatureFamily(p) === f).length]));
  return { categoryCounts, quality: places.length >= 8 && Object.values(categoryCounts).filter(Boolean).length >= 3 ? "sufficient" : places.length ? "limited" : "unavailable" };
}
export async function areaSignature(manifest: CityManifest, area: ManifestArea, options: { enrich?: boolean } = {}): Promise<AreaSignature> {
  const enrich = options.enrich !== false;
  const key = hash([manifest.version, area.identity, area.venueIds, SIGNATURE_METHOD, enrich]);
  const result = await signatures.get(key, async () => {
    let places = selectSignaturePlaces(manifest.catalog.filter(p => pointInArea([p.lon, p.lat], area.identity)));
    const localEvidence: EvidenceRef[] = [];
    let unavailable = manifest.notes.some(note => note.includes("was unavailable"));
    // One neutral, bounded query per missing family. A city-wide top-100 catalog
    // cannot establish that a small neighborhood has no everyday places.
    if (enrich && signatureSupport(places).quality !== "sufficient") {
      const missing = FAMILIES.filter(f => places.filter(p => signatureFamily(p) === f).length < 2);
      const batches = await mapLimit(missing, 2, async family => {
        try {
          const center = area.identity.center;
          const read = await qlooRead("/v2/insights", { "filter.type": "urn:entity:place", "filter.location": `POINT(${center[0]} ${center[1]})`, "filter.location.radius": 650, "filter.tags": NEUTRAL_FAMILIES[family].join(","), "operator.filter.tags": "union", take: 25 });
          const rows = resultRows(read.value, "entities");
          localEvidence.push(evidenceRef("qloo_entity", read, rows.flatMap(r => string(r.entity_id) ?? []), SIGNATURE_METHOD));
          return rows.flatMap(r => rowPlace(r) ?? []).filter(p => pointInArea([p.lon, p.lat], area.identity));
        } catch { unavailable = true; return []; }
      });
      places = selectSignaturePlaces([...places, ...batches.flat()]);
    }
    const representatives = signatureRepresentatives(places);
    const support = signatureSupport(places);
    const style = styleTermFrequency(places);
    let music: SignatureFeature[] = [], musicStatus: AreaSignature["musicStatus"] = "no_signal";
    const evidence = [...manifest.evidence.filter(e => e.kind === "geocode" || e.entityIds?.some(id => places.some(p => p.id === id))), ...localEvidence];
    // Unsupported areas remain limited; don't spend a music query to make them look complete.
    if (MUSIC_SIGNATURE_ENABLED && support.quality === "sufficient" && representatives.length) {
      try {
        const read = await qlooRead("/v2/insights", { "filter.type": "urn:tag", "filter.tag.types": "urn:tag:genre:music", "signal.interests.entities": representatives.map(p => p.id).sort().join(","), take: 25 });
        music = resultRows(read.value, "tags").flatMap((row, rank) => { const tag = tagRef(row); return tag?.id.startsWith("urn:tag:genre:music:") ? [{ id: tag.id, label: tag.name, tf: 1 / (rank + 2) }] : []; });
        musicStatus = music.length ? "ok" : "no_signal";
        evidence.push(evidenceRef("qloo_tags", read, representatives.map(p => p.id), SIGNATURE_METHOD));
      } catch { musicStatus = "unavailable"; }
    }
    return { area, manifest, places, representatives, ...support, ...(unavailable ? { quality: "limited" as const } : {}), style, music, musicStatus, unavailable,
      missingFamilies: [...(!style.length ? ["placeStyle"] : []), ...(MUSIC_SIGNATURE_ENABLED && !music.length ? ["musicTaste"] : [])], evidence: uniqueEvidence(evidence) };
  });
  if (result.value.musicStatus === "unavailable" || result.value.unavailable) signatures.delete(key);
  return result.value;
}
/** Equal city weighting: each city contributes total document weight one. */
export function buildIdf(cities: { documents: string[][] }[]): Map<string, number> {
  const usable = cities.filter(c => c.documents.length), count = usable.length;
  const df = new Map<string, number>();
  for (const city of usable) for (const document of city.documents) for (const id of new Set(document)) df.set(id, (df.get(id) ?? 0) + 1 / city.documents.length);
  return new Map([...df].map(([id, frequency]) => [id, frequency / count > .65 ? 0 : Math.min(3, Math.log((count + 1) / (frequency + 1)) + 1)]));
}
export function weightedVector(features: SignatureFeature[], idf: Map<string, number>, cityCount: number): Map<string, number> {
  const weighted = features.map(f => [f.id, f.tf * (idf.get(f.id) ?? Math.min(3, Math.log(cityCount + 1) + 1))] as const).filter(([, value]) => value > 0);
  const total = weighted.reduce((s, [, value]) => s + value, 0);
  return new Map(weighted.map(([id, value]) => [id, value / total]));
}
export function weightedJaccard(a: Map<string, number>, b: Map<string, number>): number | null {
  if (!a.size || !b.size) return null;
  let numerator = 0, denominator = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) { numerator += Math.min(a.get(key) ?? 0, b.get(key) ?? 0); denominator += Math.max(a.get(key) ?? 0, b.get(key) ?? 0); }
  return denominator ? numerator / denominator : null;
}
export function signatureVectors(signature: Pick<AreaSignature, "style" | "music">, reference: SignatureReference) {
  return { style: weightedVector(signature.style, reference.styleIdf, reference.cities.length), music: weightedVector(signature.music, reference.musicIdf, reference.cities.length) };
}
export function signatureSimilarity(source: Pick<AreaSignature, "style" | "music">, target: Pick<AreaSignature, "style" | "music" | "quality">, reference: SignatureReference, method: "style_only_v1" | "style_music_v1"): number | null {
  if (target.quality !== "sufficient") return null;
  const a = signatureVectors(source, reference), b = signatureVectors(target, reference);
  const style = weightedJaccard(a.style, b.style);
  if (style === null) return null;
  if (method === "style_only_v1") return 100 * style;
  const music = weightedJaccard(a.music, b.music);
  return music === null ? null : 100 * (.65 * style + .35 * music);
}
export async function signatureReference(): Promise<SignatureReference> {
  return (await references.get(SIGNATURE_METHOD, async () => {
    const loaded = await mapLimit([...REFERENCE_CITIES], 2, async city => {
      try {
        const { value: manifest } = await cityManifest(city).catch(() => cityManifest(city));
        // Style IDF uses the same neutral city catalogs; local supplementation is
        // for source/target support and never refits the frozen background.
        const local = await mapLimit(manifest.areas, 3, area => areaSignature(manifest, area, { enrich: false }));
        return { manifest, signatures: local };
      } catch { return null; }
    });
    const valid = loaded.filter((city): city is NonNullable<typeof city> => !!city);
    if (valid.length !== REFERENCE_CITIES.length || valid.some(c => c.manifest.notes.some(note => note.includes("was unavailable")))) throw apiError("qloo_unavailable", "The fixed cultural reference is still loading. Retry shortly; incomplete cities will not change its scoring scale.", true);
    const styleIdf = buildIdf(valid.map(city => ({ documents: city.manifest.catalog.map(place => placeStyleFeatures(place).map(t => t.id)) })));
    const musicIdf = buildIdf(valid.map(city => ({ documents: city.signatures.filter(s => s.music.length).map(s => s.music.map(t => t.id)) })));
    const version = `balanced-berlin-lisbon-reykjavik-style-v2:${hash([valid.map(c => c.manifest.version), [...styleIdf].sort(), [...musicIdf].sort()])}`;
    return { version, cities: valid.map(c => c.manifest.cityId), styleIdf, musicIdf,
      citySignatures: new Map(valid.map(c => [c.manifest.cityId, c.signatures])), manifests: new Map(valid.map(c => [c.manifest.cityId, c.manifest])),
      evidence: uniqueEvidence(valid.flatMap(c => c.signatures.flatMap(s => s.evidence))), complete: valid.length === REFERENCE_CITIES.length };
  })).value;
}
export async function targetSignatures(manifest: CityManifest, reference: SignatureReference): Promise<AreaSignature[]> {
  const fixedManifest = reference.manifests.get(manifest.cityId) ?? manifest;
  return mapLimit(fixedManifest.areas, 3, area => areaSignature(fixedManifest, area));
}

