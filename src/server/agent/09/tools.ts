import {
  NeighborhoodsResponseV2, HomeResponseV2, DecidesResponseV2, CitiesResponseV2, SpotResponseV2, PlacesResponseV2, PlanResponseV2,
  type AgentCardV2, type EvidenceRef, type ResultMeta, type ToolOutcome, type PlacesRequestV2, type PlanRequestV2,
} from "@/shared/contracts-09";
import { neighborhoodsV2, decidesV2 } from "@/server/engine/09/analysis-api";
import { homeV2 } from "@/server/engine/09/home-api";
import { citiesV2 } from "@/server/engine/09/comparison";
import { spotV2 } from "@/server/engine/09/address-api";
import { placesV2 } from "@/server/engine/09/venues-api";
import { planV2, auditVisit } from "@/server/engine/09/visit-api";
import { venueEligibility } from "@/server/engine/09/eligibility";
import { apiError } from "@/shared/contracts";
import { withQlooBudget } from "@/server/qloo/budget";
import { profileHash } from "@/server/engine/09/core";
import { asFailure, withSignal } from "../errors";

export const services = { rank_areas: neighborhoodsV2, translate_home: homeV2, explain_area: decidesV2, compare_cities: citiesV2, evaluate_address: spotV2, find_venues: placesV2, build_visit: planV2 };
export type Services = typeof services;
export type ToolName = keyof Services;
export const responseSchemas = { rank_areas: NeighborhoodsResponseV2, translate_home: HomeResponseV2, explain_area: DecidesResponseV2, compare_cities: CitiesResponseV2, evaluate_address: SpotResponseV2, find_venues: PlacesResponseV2, build_visit: PlanResponseV2 };
export type ToolResponse<K extends ToolName> = Awaited<ReturnType<Services[K]>>;
export type Execution = { [K in ToolName]: { tool: K; data: ToolResponse<K> } }[ToolName];
export const toolLabels: Record<ToolName, string> = {
  rank_areas: "Comparing areas and their everyday places", translate_home: "Finding places with a familiar cultural profile", explain_area: "Checking what changes when a love is removed",
  compare_cities: "Comparing the cities on the same basis", evaluate_address: "Locating the address and checking places nearby", find_venues: "Checking venues against your preferences", build_visit: "Building and checking your neighborhood visit",
};
export async function callTool<K extends ToolName>(tool: K, input: Parameters<Services[K]>[0], goalId: string, signal: AbortSignal, implementation: Services = services, onProgress?: (data: ToolResponse<K>) => void): Promise<ToolOutcome<ToolResponse<K>>> {
  const started = performance.now(); let charges = 0;
  try {
    signal.throwIfAborted();
    // K selects both argument and output schema; runtime parsing also checks injected providers.
    const invoke = implementation[tool] as (input: Parameters<Services[K]>[0], progress?: (data: ToolResponse<K>) => void) => Promise<ToolResponse<K>>;
    const progress = (value: ToolResponse<K>) => {
      if (!onProgress || signal.aborted) return;
      const parsed = responseSchemas[tool].safeParse(value);
      if (parsed.success && parsed.data.meta.stateRevision === input.stateRevision && parsed.data.meta.profileHash === profileHash(input.state, input.constraints)) onProgress(parsed.data as ToolResponse<K>);
    };
    const data = responseSchemas[tool].parse(await withQlooBudget(192, () => withSignal(invoke(input, progress), signal), used => { charges = used; })) as ToolResponse<K>;
    if (data.meta.stateRevision !== input.stateRevision || data.meta.profileHash !== profileHash(input.state, input.constraints)) throw new Error("The tool returned results for different inputs");
    if (tool === "find_venues") {
      const request = input as PlacesRequestV2;
      if ((data as PlacesResponseV2).venues.some(v => !venueEligibility(v.place, request.intent, request.constraints).allowed)) throw apiError("qloo_unavailable", "The venue results did not pass the requested role and requirements check.", true);
    }
    if (tool === "build_visit" && auditVisit(data as PlanResponseV2, input as PlanRequestV2).hardViolations.length) throw apiError("qloo_unavailable", "The visit failed its final validation. Please retry this step.", true);
    return { id: data.meta.analysisId, status: data.meta.status === "partial" ? "partial" : "ok", data, evidence: data.evidence, satisfiedGoalIds: [], unmet: [], cost: { qlooCacheMissCharges: charges, elapsedMs: performance.now() - started } };
  } catch (error) {
    if (signal.aborted) throw error;
    const failure = asFailure(error, "qloo").body.error;
    return { id: `failure:${goalId}:${tool}`, status: "failed", evidence: [], satisfiedGoalIds: [], unmet: [{ goalId, reason: failure.message, recoverable: failure.retryable ?? false }], error: { code: failure.code, message: failure.message, retryable: failure.retryable ?? false }, cost: { qlooCacheMissCharges: charges, elapsedMs: performance.now() - started } };
  }
}
export function cardFor(result: Execution): AgentCardV2 {
  switch (result.tool) {
    case "rank_areas": return { kind: "areas", areas: result.data.areas.slice(0, 3) };
    case "translate_home": return { kind: "home", matches: result.data.matches.slice(0, 3), sourceSignatureSummary: result.data.sourceSignatureSummary };
    case "explain_area": return { kind: "explanation", claims: result.data.claims, ablations: result.data.ablations };
    case "compare_cities": return { kind: "comparison", result: result.data };
    case "evaluate_address": return { kind: "address", result: result.data };
    case "find_venues": return { kind: "venues", venues: result.data.venues.slice(0, 8) };
    case "build_visit": return { kind: "visit", result: result.data };
  }
}
export type ResultEnvelope = { meta: ResultMeta; evidence: EvidenceRef[]; card: AgentCardV2 };
export const resultEnvelope = (result: Execution): ResultEnvelope => ({ meta: result.data.meta, evidence: result.data.evidence, card: cardFor(result) });
export function validateClaims(claims: { text: string; evidenceIds: string[] }[], evidence: EvidenceRef[]): boolean {
  const ids = new Set(evidence.map(e => e.id));
  return claims.every(c => !!c.text.trim() && c.evidenceIds.every(id => ids.has(id)));
}
