import { z } from "zod";
import { Domain, EntityRef, ExploreState, LIMITS, Neighborhood, ResolvedLove, StatePatch, TagRef } from "@/shared/contracts";
import { applyPatches } from "@/shared/patches";
import { searchEntities, searchPlaceTags } from "@/server/qloo";
import { rankNeighborhoods } from "@/server/engine";
import { asFailure, fail, withSignal } from "./errors";
import type { ChatTool } from "./llm";
import { rankingChanged } from "./final";

// filler words, and kinds of place the plan already covers by category (cafes, bars), so the tags carry the rest
const STOP = new Set(["the", "and", "with", "near", "for", "from", "that", "this", "some", "place", "places", "spot", "spots", "find", "want", "like", "good", "nice", "lots", "more", "less", "very", "really",
  "cafe", "cafes", "café", "cafés", "coffee", "bar", "bars", "restaurant", "restaurants", "food", "eat", "drink", "drinks"]);

/** The separate ideas inside a place request, at most four. */
export function placeWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length >= 3 && !STOP.has(word)))].slice(0, 4);
}

export const ToolArguments = {
  search_entities: z.strictObject({ name: z.string().trim().min(1).max(120), domain: Domain.optional(), reference_for: z.string().trim().min(1).max(120).optional() }),
  search_place_tags: z.strictObject({ text: z.string().trim().min(1).max(120) }),
  apply_changes: z.strictObject({ ops: z.array(StatePatch).min(1).max(16) }),
  get_ranking: z.strictObject({}),
  explain_neighborhood: z.strictObject({ id: z.string().min(1).max(200) }),
};

export const AGENT_TOOLS: ChatTool[] = [
  { name: "search_entities", description: "Look up a named favourite. For a genre/scene choose 1–2 well-known representatives and look them all up in parallel, setting reference_for to the original genre. Use domain artist for music and tv_show for TV. Preserve returned id/name/domain in patches; omit optional metadata and use candidates:[]." },
  { name: "search_place_tags", description: "Find supported place tags for ONE preference, e.g. quiet, waterfront, laptop friendly, wifi. Search each idea separately in parallel. Use returned tag objects verbatim." },
  { name: "apply_changes", description: "Atomically validate and apply StatePatch ops, including set_budget(budget:1..4|null), set_pace(pace:relaxed|balanced|packed), set_start(hour:6..12), remove_love(query), set_weight(query,weight:0..1). Budget/pace/start/days change plans without reranking. Resolve only NEW entities/tags with search first. Patches are the only way to change state." },
  { name: "get_ranking", description: "Build the taste field and rank up to eight neighborhoods using the latest state. Call after changes when a recommendation is needed." },
  { name: "explain_neighborhood", description: "Return evidence for a neighborhood from the current ranking; never invent a neighborhood id." },
].map(({ name, description }) => ({
  type: "function", function: { name, description, parameters: z.toJSONSchema(ToolArguments[name as keyof typeof ToolArguments]) },
}));

export type ToolContext = {
  state: ExploreState;
  entities: Map<string, EntityRef>;
  tags: Map<string, TagRef>;
  ranking: Neighborhood[] | null;
  addedRefinements: Set<string>;
  references: Map<string, string>;
  signal: AbortSignal;
};
export type ToolResult = { summary: string; value: unknown; ops?: StatePatch[] };

export function createToolContext(state: ExploreState, signal: AbortSignal): ToolContext {
  const context: ToolContext = { state: ExploreState.parse(state), entities: new Map(), tags: new Map(), ranking: null, addedRefinements: new Set(), references: new Map(), signal };
  for (const love of [...state.loves, ...(state.companion?.loves ?? [])]) {
    for (const entity of [...love.candidates, ...(love.chosen ? [love.chosen] : [])]) context.entities.set(entityKey(entity), entity);
  }
  for (const tag of state.refinements) context.tags.set(tag.id, tag);
  return context;
}

export function entityKey(entity: EntityRef): string {
  const id = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(entity.id) ? entity.id.toLowerCase() : entity.id;
  return `${id}:${entity.domain}`;
}

export function validateLove(love: ResolvedLove, context: ToolContext): void {
  if (!love.query.trim()) throw fail("bad_input", "A favourite needs a name.", 400);
  for (const entity of [...love.candidates, ...(love.chosen ? [love.chosen] : [])]) {
    const known = context.entities.get(entityKey(entity));
    if (!known || known.name.trim().toLowerCase() !== entity.name.trim().toLowerCase()) {
      throw fail("bad_input", "Search for the favourite before adding it; preserve its returned id, name and domain.", 400);
    }
  }
}

/** Models may omit optional metadata; the lookup remains authoritative. */
export function canonicalizeLove(love: ResolvedLove, context: ToolContext): ResolvedLove {
  validateLove(love, context);
  return ResolvedLove.parse({
    ...love,
    chosen: love.chosen ? context.entities.get(entityKey(love.chosen)) : null,
    candidates: love.candidates.map((entity) => context.entities.get(entityKey(entity))),
  });
}

export function canonicalizeChanges(ops: StatePatch[], context: ToolContext): StatePatch[] {
  return ops.map((op) => {
    if (op.op === "add_love") return { ...op, love: canonicalizeLove(op.love, context) };
    if (op.op === "set_companion" && op.loves) {
      const loves = op.loves.map((love) => canonicalizeLove(love, context));
      const represented = new Set(loves.flatMap((love) => love.chosen ? [context.references.get(entityKey(love.chosen))?.toLowerCase()] : []));
      return { ...op, loves: loves.filter((love) => love.chosen || !represented.has(love.query.toLowerCase())) };
    }
    return op;
  });
}

export function validateChanges(ops: StatePatch[], context: ToolContext): void {
  const additions = new Set(context.addedRefinements);
  for (const op of ops) {
    if (op.op === "add_refinement" && !context.state.refinements.some((tag) => tag.id === op.tag.id)) additions.add(op.tag.id);
  }
  if (additions.size > 2) throw fail("bad_input", "Add at most two new place preferences per request. Choose laptop friendly, free wifi or cafe when relevant.", 400);
  const changedProfile = rankingChanged(context.state, applyPatches(context.state, ops.filter((op) => op.op !== "select_neighborhood")));
  for (const op of ops) {
    if (op.op === "set_city" && !op.city.trim()) throw fail("bad_input", "A city needs a name.", 400);
    if (op.op === "add_love") validateLove(op.love, context);
    if (op.op === "set_companion" && op.loves) {
      if (op.loves.length > LIMITS.companionLoves) throw fail("bad_input", "Add at most eight partner favourites.", 400);
      for (const love of op.loves) validateLove(love, context);
    }
    if (op.op === "add_refinement") {
      const known = context.tags.get(op.tag.id);
      if (!known || JSON.stringify(TagRef.parse(known)) !== JSON.stringify(TagRef.parse(op.tag))) {
        throw fail("bad_input", "Search for a place tag before adding it; use the returned tag unchanged.", 400);
      }
    }
    if (op.op === "select_neighborhood" && op.id !== null && (changedProfile || !context.ranking?.some((n) => n.id === op.id))) {
      throw fail("bad_input", "Choose a neighborhood from the current ranking.", 400);
    }
  }
}

export async function getRanking(context: ToolContext): Promise<Neighborhood[]> {
  if (context.ranking) return context.ranking;
  try {
    context.ranking = z.array(Neighborhood).parse(await withSignal(rankNeighborhoods(context.state), context.signal)).slice(0, 8);
    return context.ranking;
  } catch (error) { throw asFailure(error, "qloo"); }
}

export async function executeTool(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
  context.signal.throwIfAborted();
  switch (name) {
    case "search_entities": {
      const { name: query, domain, reference_for } = ToolArguments.search_entities.parse(input);
      let results: EntityRef[];
      try { results = z.array(EntityRef).parse(await withSignal(searchEntities(query, domain), context.signal)).slice(0, 6); }
      catch (error) { throw asFailure(error, "qloo"); }
      for (const entity of results) {
        context.entities.set(entityKey(entity), entity);
        if (reference_for) context.references.set(entityKey(entity), reference_for);
      }
      return { summary: `Looked up “${query}”`, value: { results: results.map(({ id, name, domain }) => ({ id, name, domain })) } };
    }
    case "search_place_tags": {
      const { text } = ToolArguments.search_place_tags.parse(input);
      let results: TagRef[];
      try {
        results = z.array(TagRef).parse(await withSignal(searchPlaceTags(text), context.signal));
        // Qloo tags are single ideas: "quiet cafe waterfront" finds nothing, "quiet" and "waterfront" do
        const words = placeWords(text);
        if (!results.length && words.length > 1)
          results = (await Promise.all(words.map((word) => withSignal(searchPlaceTags(word), context.signal).catch(() => [] as TagRef[]))))
            .flatMap((found) => z.array(TagRef).parse(found).slice(0, 15));
      }
      catch (error) { throw asFailure(error, "qloo"); }
      for (const tag of results) context.tags.set(tag.id, tag);
      return { summary: `Looked for places matching “${text}”`, value: { results } };
    }
    case "apply_changes": {
      const proposed = ToolArguments.apply_changes.parse(input);
      validateChanges(proposed.ops, context);
      const ops = canonicalizeChanges(proposed.ops, context);
      const next = ExploreState.parse(applyPatches(context.state, ops));
      const changed = JSON.stringify(next) !== JSON.stringify(context.state);
      if (changed) {
        for (const tag of next.refinements) {
          if (!context.state.refinements.some((current) => current.id === tag.id)) context.addedRefinements.add(tag.id);
        }
        if (rankingChanged(context.state, next)) context.ranking = null;
        context.state = next;
      }
      return { summary: changed ? "Updated your taste profile" : "Your profile already matches these changes", value: { changed, state: context.state }, ...(changed ? { ops } : {}) };
    }
    case "get_ranking": {
      ToolArguments.get_ranking.parse(input);
      const neighborhoods = await getRanking(context);
      return { summary: `Ranked ${neighborhoods.length} neighborhoods in ${context.state.city}`, value: { neighborhoods } };
    }
    case "explain_neighborhood": {
      const { id } = ToolArguments.explain_neighborhood.parse(input);
      const neighborhood = (await getRanking(context)).find((n) => n.id === id);
      if (!neighborhood) throw fail("not_found", "That neighborhood is not in the current ranking.", 404);
      return { summary: `Checked why ${neighborhood.name} fits your taste`, value: { neighborhood } };
    }
    default: throw fail("bad_input", "Unknown assistant tool.", 400);
  }
}
