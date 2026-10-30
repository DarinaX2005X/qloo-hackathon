import type { AnalysisRequestV2, DecidesRequestV2, DecidesResponseV2, FieldResponseV2, NeighborhoodsResponseV2 } from "@/shared/contracts-09";
import { analyzeAreas, withoutLoveMetrics } from "./ranking";
import { evidenceRef, hash, METHOD_VERSION, resultMeta } from "./core";

export async function fieldV2(input: AnalysisRequestV2): Promise<FieldResponseV2> {
  const { value: analysis, hit } = await analyzeAreas(input);
  return { meta: resultMeta(input, analysis.manifest, { hit, partial: analysis.support.quality !== "sufficient", dataAsOf: analysis.dataAsOf }), field: analysis.field, support: analysis.support };
}
export async function neighborhoodsV2(input: AnalysisRequestV2, onProgress?: (result: NeighborhoodsResponseV2) => void): Promise<NeighborhoodsResponseV2> {
  const { value: analysis, hit } = await analyzeAreas(input, onProgress ? initial => onProgress({
    meta: resultMeta(input, initial.manifest, { partial: true, dataAsOf: initial.dataAsOf }), areas: initial.areas,
    allCandidateIds: initial.manifest.areas.map(a => a.identity.id), evidence: initial.evidence,
  }) : undefined);
  return { meta: resultMeta(input, analysis.manifest, { hit, partial: analysis.areas.slice(0, 3).some(a => a.recommendationStatus !== "recommended"), dataAsOf: analysis.dataAsOf }),
    areas: analysis.areas, allCandidateIds: analysis.manifest.areas.map(a => a.identity.id), evidence: analysis.evidence };
}
export async function decidesV2(input: DecidesRequestV2): Promise<DecidesResponseV2> {
  const { value: analysis, hit } = await analyzeAreas(input);
  const selected = input.areaId ? analysis.areas.filter(a => a.area.id === input.areaId) : analysis.areas.slice(0, 3);
  const ablations = analysis.yours.flatMap(love => {
    const without = withoutLoveMetrics(analysis, love.entityId);
    return selected.map(area => {
      const next = without?.get(area.area.id);
      return { areaId: area.area.id, loveId: love.entityId, baseRank: area.metrics.rank, withoutRank: next?.rank ?? null,
        deltaTasteScore: area.metrics.tasteScore - (next?.tasteScore ?? .5), tieChanged: !!next && Math.abs(area.metrics.tasteScore - next.tasteScore) > .01 && next.rank !== area.metrics.rank };
    });
  });
  const derived = evidenceRef("derived", { fetchedAt: analysis.generatedAt, requestHash: hash([analysis.manifest.version, ablations]) }, analysis.yours.map(l => l.entityId), METHOD_VERSION);
  const changing = ablations.find(a => a.tieChanged && a.baseRank === 1);
  const love = changing ? analysis.yours.find(l => l.entityId === changing.loveId) : undefined;
  const claims = [{ text: changing && love ? `Without ${love.query}, this area moves from #${changing.baseRank} to #${changing.withoutRank}.`
    : ablations.some(a => a.withoutRank === null) ? "Removing the only available love leaves no cultural ranking."
    : "This choice is stable when any one love is removed within the comparison's tie band.", evidenceIds: [derived.id] }];
  return { meta: resultMeta(input, analysis.manifest, { hit, partial: analysis.support.quality !== "sufficient", dataAsOf: analysis.dataAsOf, suffix: ["explanation", input.areaId] }), baseOrder: analysis.areas.map(a => a.area.id), ablations, claims, evidence: [...analysis.evidence, derived] };
}
