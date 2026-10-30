import { ExploreState, activeLoves, type EntityRef, type StatePatch, type TagRef } from "@/shared/contracts";
import type { AgentRequestV2, Constraint, EvidenceRef } from "@/shared/contracts-09";
import { applyPatches } from "@/shared/patches";
import { validateCity } from "@/server/geo/geocode";
import { searchEntities, normalizeEntityName, tagRef } from "@/server/qloo/search";
import { qlooRead, resultRows } from "@/server/qloo/client";
import { evidenceRef, hash, normalized } from "@/server/engine/09/core";
import { withSignal } from "../errors";
import { mergeConstraints } from "./constraints";
import { quoteInRequest, type DecisionPlan } from "./planning";

export type PreparationServices = { search: typeof searchEntities; validateCity: typeof validateCity; tags: typeof temporaryMusicTags };
export const preparationServices: PreparationServices = { search: searchEntities, validateCity, tags: temporaryMusicTags };
export type PreparedProfile = { state: ExploreState; constraints: Constraint[]; ops: StatePatch[]; unresolved: string[]; changes: string[]; evidence: EvidenceRef[]; temporaryTagIds: string[] };
export async function temporaryMusicTags(text: string): Promise<{ tags: TagRef[]; evidence: EvidenceRef[] }> {
  const query = normalized(text).split(" ").filter(w => !["dark", "some", "music", "dance", "dancing", "venue", "venues"].includes(w)).join(" ") || text;
  const read = await qlooRead("/v2/tags", { "filter.query": query, "filter.tag.types": "urn:tag:genre:music", take: 10 });
  const tags = resultRows(read.value, "tags").flatMap(row => tagRef(row) ?? []).filter(t => t.id.startsWith("urn:tag:genre:music:") && normalized(t.name).includes(normalized(query))).slice(0, 2);
  return { tags, evidence: [evidenceRef("qloo_tags", read)] };
}
export function sameRevisionInputs(a: ExploreState, ac: Constraint[], b: ExploreState, bc: Constraint[]): boolean {
  const key = (s: ExploreState, constraints: Constraint[]) => JSON.stringify([
    s.city.trim().toLowerCase(), activeLoves(s.loves).map(l => [l.chosen.id, l.weight]), s.refinements.map(t => t.id), s.discovery, s.budget,
    s.companion ? activeLoves(s.companion.loves).map(l => [l.chosen.id, l.weight]) : null,
    [...constraints].sort((x, y) => x.id.localeCompare(y.id)).map(c => [c.id, c.kind, c.value, c.strength]),
  ]);
  return key(a, ac) === key(b, bc);
}
export async function prepareProfile(input: AgentRequestV2, plan: DecisionPlan, signal: AbortSignal, progress: (step: string, status: "running" | "done" | "failed", text: string) => void, implementation: PreparationServices = preparationServices): Promise<PreparedProfile> {
  const ops: StatePatch[] = [], unresolved: string[] = [], changes: string[] = [], evidence: EvidenceRef[] = [];
  const constraints = mergeConstraints(input.memory.constraints, plan, input.message);
  const explicitCityChange = /\b(?:moving|move|going|go|switch|change|open|show|map)\b/i.test(input.message);
  for (const op of plan.ops) {
    if (op.op === "set_city") {
      if ((!plan.cities.length || plan.open?.kind === "city") && explicitCityChange && quoteInRequest(op.city.split(",")[0], input.message)) {
        progress("city", "running", `Checking the city ${op.city}`);
        try { const found = await withSignal(implementation.validateCity(op.city), signal); ops.push({ ...op, city: found.name }); changes.push(`The map is set to ${found.name}.`); progress("city", "done", `Located ${found.name}`); }
        catch (error) { progress("city", "failed", `Could not locate ${op.city}`); throw error; }
      }
    } else if (op.op === "remove_love" || op.op === "set_weight") {
      const love = input.state.loves.find(l => normalized(l.query) === normalized(op.query) || normalized(l.chosen?.name ?? "") === normalized(op.query));
      if (love && quoteInRequest(op.query, input.message) && /\b(?:remove|forget|less|more|matters|weight|half|double|drop)\b/i.test(input.message)) {
        ops.push(op); changes.push(op.op === "remove_love" ? `Removed ${love.query} from your loves.` : `Changed the weight of ${love.query} from ${love.weight} to ${op.weight}.`);
      }
    } else if (op.op === "remove_refinement") {
      if (input.state.refinements.some(t => t.id === op.id && quoteInRequest(t.name, input.message)) && /remove|forget|drop/i.test(input.message)) ops.push(op);
    } else if (op.op === "set_companion") {
      if (op.loves === null && /(?:remove|forget|without)\s+(?:my\s+)?partner/i.test(input.message)) ops.push(op);
    } else if (op.op === "set_days" && /days?|trip|itinerary/i.test(input.message)) ops.push(op);
    else if (op.op === "set_budget" && /budget|cheap|price|\$|money/i.test(input.message)) ops.push(op);
    else if (op.op === "set_pace" && /relaxed|slow|pack|balanced|pace/i.test(input.message)) ops.push(op);
    else if (op.op === "set_start" && /start|morning|early|late|sleep/i.test(input.message)) ops.push(op);
    // Models cannot directly add arbitrary entity/tag IDs or silently move selection.
  }
  const entities = plan.entities.filter(entity => {
    if (quoteInRequest(entity.name, input.message)) return true;
    unresolved.push(`I did not add ${entity.name}; it was not an explicitly named love in this request.`); return false;
  });
  let tags: Awaited<ReturnType<typeof temporaryMusicTags>> = { tags: [], evidence: [] };
  if (entities.length) progress("resolve_entities", "running", "Looking up your named loves");
  if (plan.venues?.temporaryIntent) progress("resolve_intent_tags", "running", "Looking up music styles for this search");
  const [resolved, tagged] = await Promise.allSettled([
    Promise.allSettled(entities.map(async entity => {
      const found = await withSignal(implementation.search(entity.name, entity.domain), signal);
      const exact = found.filter(e => normalizeEntityName(e.name) === normalizeEntityName(entity.name));
      const chosen: EntityRef | null = exact.length === 1 ? exact[0] : null;
      if (!chosen) unresolved.push(found.length ? `Which result did you mean by ${entity.name}? Choose a precise match in your taste profile.` : `No exact match was found for ${entity.name}.`);
      evidence.push(evidenceRef("derived", { fetchedAt: new Date().toISOString(), requestHash: hash([entity.name, found.map(e => e.id)]) }, found.map(e => e.id), "verified-entity-resolution-v1"));
      return { target: entity.target, love: { query: entity.name, chosen, candidates: found, weight: 1 } };
    })),
    plan.venues?.temporaryIntent ? withSignal(implementation.tags(plan.venues.temporaryIntent), signal) : Promise.resolve(tags),
  ]);
  if (signal.aborted) signal.throwIfAborted();
  if (resolved.status === "fulfilled") {
    const partner = [...(input.state.companion?.loves ?? [])];
    for (const [index, resolution] of resolved.value.entries()) {
      if (resolution.status === "rejected") { unresolved.push(`The lookup for ${entities[index].name} was unavailable. Retry this love.`); continue; }
      const item = resolution.value;
      const current = item.target === "you" ? input.state.loves : partner;
      if (current.some(l => normalized(l.query) === normalized(item.love.query) || l.chosen?.id && l.chosen.id === item.love.chosen?.id)) continue;
      if (current.length + (item.target === "you" ? ops.filter(op => op.op === "add_love").length : 0) >= 8) { unresolved.push(`The eight-love limit prevented adding ${item.love.query}.`); continue; }
      if (item.target === "you") ops.push({ op: "add_love", love: item.love }); else partner.push(item.love);
      if (item.love.chosen) changes.push(`Added ${item.love.chosen.name}${item.target === "partner" ? " to your partner's loves" : " to your loves"}.`);
    }
    if (partner.length !== (input.state.companion?.loves.length ?? 0)) ops.push({ op: "set_companion", loves: partner });
    if (entities.length) progress("resolve_entities", "done", "Checked the named loves against the taste catalog");
  } else { unresolved.push("The named loves could not be looked up. Please retry their lookup."); progress("resolve_entities", "failed", "The taste lookup was unavailable"); }
  if (tagged.status === "fulfilled") { tags = tagged.value; evidence.push(...tags.evidence); if (plan.venues?.temporaryIntent) progress("resolve_intent_tags", "done", tags.tags.length ? `Using ${tags.tags.map(t => t.name).join(" and ")} for this search only` : "No matching music style tag was found"); }
  else { if (plan.venues?.temporaryIntent) progress("resolve_intent_tags", "failed", "The music style lookup was unavailable"); unresolved.push("The temporary music style could not be verified; only your existing music loves can be used."); }
  return { state: ExploreState.parse(applyPatches(input.state, ops)), constraints, ops, unresolved, changes, evidence, temporaryTagIds: tags.tags.map(t => t.id) };
}
