import { z } from "zod";
import { Category, Domain, EntityRef, ExploreState, LIMITS, Neighborhood, ResolvedLove, StatePatch, TagRef, type AgentCard, type HomeResult } from "@/shared/contracts";
import { applyPatches } from "@/shared/patches";
import { searchEntities, searchPlaceTags } from "@/server/qloo";
import { rankNeighborhoods } from "@/server/engine";
import { asFailure, fail, withSignal } from "./errors";
import type { ChatTool } from "./llm";
import { cardReply, neighborhoodReply, placesReply, rankingChanged } from "./final";
import { findHome } from "@/server/engine/home";
import { checkSpot } from "@/server/engine/spot";
import { whatDecides } from "@/server/engine/decides";
import { placesNear, searchTastePlaces } from "@/server/engine/places";
import { solvePlan } from "@/server/engine/plan";

// filler words, and kinds of place the plan already covers by category (cafes, bars), so the tags carry the rest
const STOP = new Set(["the", "and", "with", "near", "for", "from", "that", "this", "some", "place", "places", "spot", "spots", "find", "want", "like", "good", "nice", "lots", "more", "less", "very", "really",
  "cafe", "cafes", "café", "cafés", "coffee", "bar", "bars", "restaurant", "restaurants", "food", "eat", "drink", "drinks"]);

/** The separate ideas inside a place request, at most four. */
export function placeWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length >= 3 && !STOP.has(word)))].slice(0, 4);
}

/** Preserve an explicit constraint even if the model omits it from a tool call. */
export function explicitlyAvoidsMuseums(message: string): boolean {
  return /\b(?:no|without|avoid|skip|exclude)\s+(?:(?:any|all|the|art)\s+)*museums?\b|\b(?:i|we)\s+(?:hate|dislike)\s+(?:(?:visiting|art|the)\s+)*museums?\b|\b(?:don['’]t|do not)\s+(?:want|like)\s+(?:(?:any|to visit|visiting|art)\s+)*museums?\b/i.test(message);
}

export const ToolArguments = {
  search_entities: z.strictObject({ name: z.string().trim().min(1).max(120), domain: Domain.optional(), reference_for: z.string().trim().min(1).max(120).optional() }),
  search_place_tags: z.strictObject({ text: z.string().trim().min(1).max(120) }),
  apply_changes: z.strictObject({ ops: z.array(StatePatch).min(1).max(16) }),
  get_ranking: z.strictObject({}),
  explain_neighborhood: z.strictObject({ id: z.string().min(1).max(200) }),
  find_home: z.strictObject({ city: z.string().trim().min(1).max(80), neighborhood: z.string().trim().min(1).max(80) }),
  select_home_match: z.strictObject({ index: z.number().int().min(0).max(2).default(0) }),
  check_address: z.strictObject({ query: z.string().trim().min(2).max(160) }),
  what_decides: z.strictObject({}),
  get_places: z.strictObject({ neighborhood: z.string().min(1).max(200).optional(), categories: z.array(Category).min(1).max(5).optional(), intent: z.enum(["dance", "concert", "bar"]).optional() }),
  plan_trip: z.strictObject({ days: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    pace: z.enum(["relaxed", "balanced", "packed"]).optional(), startHour: z.number().int().min(6).max(12).optional(),
    neighborhood: z.string().max(200).optional(), excludeCategories: z.array(Category).max(5).optional(),
    excludeTags: z.array(z.string().min(1).max(120)).max(20).optional(), mustInclude: z.array(z.string().min(1).max(120)).max(12).optional() }),
};

export const AGENT_TOOLS: ChatTool[] = [
  { name: "search_entities", description: "Look up a named favourite. For a genre/scene choose 1–2 well-known representatives and look them all up in parallel, setting reference_for to the original genre. Use domain artist for music and tv_show for TV. Preserve returned id/name/domain in patches; omit optional metadata and use candidates:[]." },
  { name: "search_place_tags", description: "Find supported place tags for ONE preference, e.g. quiet, waterfront, laptop friendly, wifi. Search each idea separately in parallel. Use returned tag objects verbatim." },
  { name: "apply_changes", description: "Atomically validate and apply StatePatch ops, including set_budget(budget:1..4|null), set_pace(pace:relaxed|balanced|packed), set_start(hour:6..12), remove_love(query), set_weight(query,weight:0..1). Budget/pace/start/days change plans without reranking. Resolve only NEW entities/tags with search first. Patches are the only way to change state." },
  { name: "get_ranking", description: "Build the taste field and rank up to eight neighborhoods using the latest state. Call after changes when a recommendation is needed." },
  { name: "explain_neighborhood", description: "Return evidence for a neighborhood from the current ranking; id can be a returned id or the name the user mentioned." },
  { name: "find_home", description: "Find areas in the current city like an old neighborhood. city is the source city, neighborhood is the old area. Infer a missing source city only for a famous unambiguous neighborhood; otherwise ask. Does not change the profile." },
  { name: "select_home_match", description: "Select a returned home match for subsequent address/plan steps. index defaults to zero, the top match. Call only after find_home when the user asks to use the match." },
  { name: "check_address", description: "Score an address or flat in the current city and find places within walking distance. query is the address. Does not change the profile." },
  { name: "what_decides", description: "Measure robustness by removing each active love and reranking. Use for why an area is first, which love matters most, or how sure the ranking is." },
  { name: "get_places", description: "Read taste-aware places. For dancing use intent:dance, concerts intent:concert, a bar like my taste intent:bar. Searches the city with the user's loves and venue/ambience tags; excludes hotels for nightlife. Otherwise use categories and optional neighborhood." },
  { name: "plan_trip", description: "Build an actual itinerary card, not just settings. Optional days 1..3, pace, startHour, neighborhood; excludeCategories for broad categories, excludeTags for specific types. No museums or I hate museums -> excludeTags:[museum], which removes museum/gallery venues but keeps bookshops, cinemas and music venues; do not exclude all culture. mustInclude contains place names or resolved IDs. Uses selected home match after select_home_match. Reports automatic recovery, empty days and constraints it could not satisfy." },
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
  answers: string[];
  home?: HomeResult;
  request?: string;
};
export type ToolResult = { summary: string; value: unknown; ops?: StatePatch[]; card?: AgentCard };

export function createToolContext(state: ExploreState, signal: AbortSignal, request?: string): ToolContext {
  const context: ToolContext = { state: ExploreState.parse(state), entities: new Map(), tags: new Map(), ranking: null, addedRefinements: new Set(), references: new Map(), signal, answers: [], request };
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
        if (rankingChanged(context.state, next)) { context.ranking = null; context.answers = []; }
        context.state = next;
      }
      return { summary: changed ? "Updated your taste profile" : "Your profile already matches these changes", value: { changed, state: context.state }, ...(changed ? { ops } : {}) };
    }
    case "get_ranking": {
      ToolArguments.get_ranking.parse(input);
      const neighborhoods = await getRanking(context);
      return { summary: `Ranked ${neighborhoods.length} neighborhoods in ${context.state.city}`, value: { neighborhoods }, card: { kind: "ranking", neighborhoods: neighborhoods.slice(0, 3) } };
    }
    case "explain_neighborhood": {
      const { id } = ToolArguments.explain_neighborhood.parse(input);
      const neighborhood = (await getRanking(context)).find((n) => n.id === id || normalizeArea(n.name) === normalizeArea(id));
      if (!neighborhood) throw fail("not_found", "That neighborhood is not in the current ranking.", 404);
      context.answers.push(neighborhoodReply(neighborhood));
      return { summary: `Checked why ${neighborhood.name} fits your taste`, value: { neighborhood } };
    }
    case "find_home": {
      const source = ToolArguments.find_home.parse(input);
      const result = await withSignal(findHome({ state: context.state, source, blend: 0 }), context.signal);
      const card: AgentCard = { kind: "home", result };
      context.home = result;
      context.answers.push(cardReply(card));
      return { summary: `Compared ${source.neighborhood}, ${source.city} with ${context.state.city}`, value: result, card };
    }
    case "select_home_match": {
      const { index } = ToolArguments.select_home_match.parse(input);
      const match = context.home?.neighborhoods[index];
      if (!match) throw fail("not_found", "Find a home match before selecting it.", 404);
      context.state = { ...context.state, neighborhood: match.id };
      return { summary: `Selected ${match.name} from the home matches`, value: { neighborhood: match }, ops: [{ op: "select_neighborhood", id: match.id }] };
    }
    case "check_address": {
      const { query } = ToolArguments.check_address.parse(input);
      const result = await withSignal(checkSpot({ state: context.state, query }), context.signal);
      const card: AgentCard = { kind: "spot", result };
      context.answers.push(cardReply(card));
      return { summary: `Checked ${result.label}`, value: result, card };
    }
    case "what_decides": {
      ToolArguments.what_decides.parse(input);
      const result = await withSignal(whatDecides(context.state), context.signal);
      const card: AgentCard = { kind: "decides", result };
      context.answers.push(cardReply(card));
      return { summary: "Checked the ranking without each love", value: result, card };
    }
    case "get_places": {
      const { neighborhood: query, categories, intent } = ToolArguments.get_places.parse(input);
      const ranking = await getRanking(context);
      const neighborhood = query ? ranking.find((n) => n.id === query || normalizeArea(n.name) === normalizeArea(query))
        : ranking.find((n) => n.id === context.state.neighborhood) ?? ranking[0];
      if (!neighborhood) throw fail("not_found", "That neighborhood is not in the current ranking.", 404);
      const places = await withSignal(intent ? searchTastePlaces(context.state, intent, query ? neighborhood : undefined) : placesNear(context.state, neighborhood, categories ?? ["food"]), context.signal);
      context.answers.push(placesReply(intent && !query ? { ...neighborhood, name: context.state.city } : neighborhood, places));
      return { summary: `Found ${places.length} places in ${neighborhood.name}`, value: { neighborhood, places } };
    }
    case "plan_trip": {
      const args = ToolArguments.plan_trip.parse(input);
      if (explicitlyAvoidsMuseums(context.request ?? "")) {
        args.excludeTags = [...new Set([...(args.excludeTags ?? []), "museum"])];
        // A model must not turn the narrow museum constraint into a blanket culture ban.
        if (!/\b(?:no|without|avoid|skip|exclude|hate|dislike)\s+(?:all\s+)?cultur(?:e|al)\b/i.test(context.request ?? ""))
          args.excludeCategories = args.excludeCategories?.filter(category => category !== "culture");
      }
      const state = { ...context.state, ...(args.days ? { days: args.days } : {}), ...(args.pace ? { pace: args.pace } : {}), ...(args.startHour ? { startHour: args.startHour } : {}) };
      const ranked = await getRanking(context);
      const choices = [...(context.home?.neighborhoods ?? []), ...ranked];
      const selected = args.neighborhood ? choices.find(n => n.id === args.neighborhood || normalizeArea(n.name) === normalizeArea(args.neighborhood!))
        : choices.find(n => n.id === state.neighborhood) ?? ranked[0];
      if (!selected) throw fail("not_found", "No ranked neighborhood is available for a plan.", 404);
      const include: string[] = [], unresolved: string[] = [];
      for (const name of args.mustInclude ?? []) {
        const known = [...context.entities.values()].find(e => e.domain === "place" && (e.id === name || normalizeArea(e.name) === normalizeArea(name)));
        const found = known ?? (await withSignal(searchEntities(name, "place"), context.signal)).find(e => normalizeArea(e.name) === normalizeArea(name));
        if (found) include.push(found.id); else unresolved.push(name);
      }
      const options = { include, excludeCategories: args.excludeCategories, excludeTags: args.excludeTags };
      const itinerary = await withSignal(solvePlan(state, [selected.id, ...ranked.filter(n => n.id !== selected.id).slice(0, state.days - 1).map(n => n.id)],
        options, context.home?.neighborhoods), context.signal);
      if (unresolved.length && itinerary.days[0]) itinerary.days[0].note = `${itinerary.days[0].note ?? ""} Could not resolve requested places: ${unresolved.join(", ")}.`.trim();
      const card: AgentCard = { kind: "plan", itinerary, options: { ...options, days: state.days, pace: state.pace, startHour: state.startHour } };
      context.answers.push(cardReply(card));
      const ops: StatePatch[] = [];
      if (state.days !== context.state.days) ops.push({ op: "set_days", days: state.days });
      if (state.pace !== context.state.pace) ops.push({ op: "set_pace", pace: state.pace });
      if (state.startHour !== context.state.startHour) ops.push({ op: "set_start", hour: state.startHour });
      context.state = state;
      return { summary: `Built ${itinerary.days.length} days; ${itinerary.days.filter(day => day.note || !day.stops.length).length} need a recovery note`, value: itinerary, card, ...(ops.length ? { ops } : {}) };
    }
    default: throw fail("bad_input", "Unknown assistant tool.", 400);
  }
}

function normalizeArea(name: string): string { return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim(); }
