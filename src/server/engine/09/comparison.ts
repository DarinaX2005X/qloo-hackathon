import { ApiError, apiError } from "@/shared/contracts";
import type { CitiesRequestV2, CitiesResponseV2, CityComparisonV2, EvidenceRef, HomeMatchV2 } from "@/shared/contracts-09";
import { median } from "../geo";
import { effectiveConstraints, mapLimit, normalized, resultMeta, uniqueEvidence } from "./core";
import { homeMethod, matchSignatures, resolveSourceSignature } from "./home-api";
import { cityManifest } from "./manifest";
import { signatureReference, targetSignatures } from "./signatures";

import { analyzeAreas } from "./ranking";

async function personalCities(input: CitiesRequestV2): Promise<CitiesResponseV2> {
  const evidence: EvidenceRef[] = [];
  const results = await mapLimit([...new Set(input.cities.map(c => c.trim()))], 2, async (city): Promise<CityComparisonV2["results"][number]> => {
    try {
      const { value: analysis } = await analyzeAreas({ ...input, state: { ...input.state, city } });
      const top = analysis.areas[0];
      evidence.push(...analysis.evidence);
      return { cityId: analysis.manifest.cityId, cityName: analysis.manifest.cityName, status: top?.metrics.support.quality === "sufficient" ? "ok" : "partial",
        areas: top ? [top] : [], culturalOverlap: null, eligibleCategories: [...new Set(top?.anchors.map(v => v.role) ?? [])],
        support: top?.metrics.support.quality ?? "unavailable", evidenceIds: analysis.evidence.map(e => e.id) };
    } catch (error) {
      const parsed = ApiError.safeParse(error);
      return { cityId: `unresolved:${normalized(city).replace(/ /g, "-")}`, cityName: city, status: "error", error: parsed.success ? parsed.data.error : { code: "qloo_unavailable", message: `Data for ${city} could not be retrieved.`, retryable: true }, areas: [], culturalOverlap: null, eligibleCategories: [], support: "unavailable", evidenceIds: [] };
    }
  });
  if (results.every(r => r.status === "error")) throw apiError("bad_input", results.map(r => `${r.cityName}: ${r.error?.message ?? "could not be checked"}`).join(" "));
  const selected = await cityManifest(input.state.city).catch(() => null);
  const geography = selected?.value ?? { cityId: `unresolved:${normalized(input.state.city)}`, version: "unavailable", fetchedAt: new Date().toISOString() };
  return { meta: resultMeta(input, geography, { method: "personal_area_rank_v1", partial: results.some(r => r.status !== "ok"), suffix: input.cities, dataAsOf: evidence.map(e => e.fetchedAt).sort()[0] }),
    criteria: ["best_area_for_your_tastes", "places_to_check"], referenceVersion: "within-city-area-ranks-v1", method: "personal_area_rank_v1", results, recommendation: null, evidence: uniqueEvidence(evidence) };
}

export async function citiesV2(input: CitiesRequestV2): Promise<CitiesResponseV2> {
  if (!input.source) return personalCities(input);
  const before = JSON.stringify(input.state);
  const reference = await signatureReference();
  const source = await resolveSourceSignature(input.source);
  const method = homeMethod(source, reference);
  const evidence: EvidenceRef[] = [...reference.evidence, ...source.evidence];
  const results = await mapLimit([...new Set(input.cities.map(c => c.trim()))], 2, async (city): Promise<CityComparisonV2["results"][number]> => {
    try {
      // City validation is inside the individual task: an invalid third city cannot erase two results.
      const { value: manifest } = await cityManifest(city);
      const targets = await targetSignatures(manifest, reference);
      const matches = matchSignatures(source, targets, reference, method, effectiveConstraints(input.state, input.constraints));
      const top = matches.filter(m => m.similarity.value !== null).slice(0, 3);
      const enough = reference.complete && source.quality === "sufficient" && top.length === 3;
      const localEvidence = uniqueEvidence(targets.flatMap(t => t.evidence)); evidence.push(...localEvidence);
      return { cityId: manifest.cityId, cityName: manifest.cityName, status: enough ? "ok" : "partial", areas: matches.slice(0, 3).map(m => m.area),
        ...(input.source ? { homeMatches: matches.slice(0, 3) } : {}), culturalOverlap: enough ? median(top.map(m => m.similarity.value!)) : null,
        eligibleCategories: [...new Set(top.flatMap(m => m.area.anchors.map(v => v.role)))], support: enough ? "sufficient" : "limited", evidenceIds: uniqueEvidence([...localEvidence, ...source.evidence]).map(e => e.id) };
    } catch (error) {
      const parsed = ApiError.safeParse(error);
      return { cityId: `unresolved:${normalized(city).replace(/ /g, "-")}`, cityName: city, status: "error", error: parsed.success ? parsed.data.error : { code: "qloo_unavailable", message: `Data for ${city} could not be retrieved.`, retryable: true }, areas: [], culturalOverlap: null, eligibleCategories: [], support: "unavailable", evidenceIds: [] };
    }
  });
  const comparable = results.filter(r => r.status === "ok" && r.culturalOverlap !== null).sort((a, b) => b.culturalOverlap! - a.culturalOverlap!);
  if (results.every(r => r.status === "error")) throw apiError("bad_input", results.map(r => `${r.cityName}: ${r.error?.message ?? "could not be checked"}`).join(" "));
  const recommendation = comparable.length >= 2 && comparable[0].culturalOverlap! - comparable[1].culturalOverlap! >= 10 && results.every(r => r.status !== "partial")
    ? { cityId: comparable[0].cityId, claims: [{ text: `${comparable[0].cityName} has the higher cultural-profile overlap in this comparison.`, evidenceIds: comparable[0].evidenceIds }] } : null;
  const selected = await cityManifest(input.state.city).catch(() => null);
  const geography = selected?.value ?? { cityId: `unresolved:${normalized(input.state.city)}`, version: "unavailable", fetchedAt: new Date().toISOString() };
  if (JSON.stringify(input.state) !== before) throw new Error("Comparison mutated selected city state");
  return { meta: resultMeta(input, geography, { method: input.source ? `home-${method}` : "personal_tags_v1", referenceVersion: reference.version, partial: results.some(r => r.status !== "ok"), suffix: [input.cities, input.source, input.criteria], dataAsOf: evidence.map(e => e.fetchedAt).sort()[0] }),
    criteria: input.criteria.length ? input.criteria : [input.source ? "home_similarity" : "cultural_overlap", "everyday_venues", "support"], referenceVersion: reference.version,
    method: input.source ? `home_${method}` as "home_style_music_v1" | "home_style_only_v1" : "personal_tags_v1", results, recommendation, evidence: uniqueEvidence(evidence) };
}

/** Shared threshold for agent audit. It is a strategy trigger, not a human satisfaction score. */
export function weakHomeMatch(matches: HomeMatchV2[]): boolean { return !matches[0] || matches[0].similarity.support !== "sufficient" || (matches[0].similarity.value ?? 0) < 35; }
