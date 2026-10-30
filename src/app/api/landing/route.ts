import type { ExploreState, Neighborhood, ResolvedLove } from "@/shared/contracts";
import type { AreaDecision, ResultMeta } from "@/shared/contracts-09";
import { searchEntities, searchTaste } from "@/server/qloo/search";
import { analyzeAreas } from "@/server/engine/09/ranking";
import { AREA_CARD_VERSION, DerivedCache, hash, METHOD_VERSION, resultMeta } from "@/server/engine/09/core";
import { withQlooBudget } from "@/server/qloo/budget";
import { errorResponse } from "@/server/engine/http";
import { pickEntity } from "@/lib/pick";
import { emptyState } from "@/lib/state";
import { LANDING, domainOf, landingName, nameOf, type LandingName, type LandingScene } from "@/components/landing/scenes";

// Hero is independently cacheable; lower maps never hold the first useful example.
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type SceneV2 = LandingScene & { areas: AreaDecision[]; meta: ResultMeta };
const scenes = new DerivedCache<SceneV2>(8, undefined, `landing-scenes:${METHOD_VERSION}:${AREA_CARD_VERSION}`);

/** A name with a domain hint is searched within that domain ("Euphoria" the show, not the novel);
 *  if the domain finds nothing, the bare name is searched as a person would type it. */
async function resolve(names: LandingName[]): Promise<ResolvedLove[]> {
  const out = await Promise.all(names.map(async (item) => {
    const query = nameOf(item);
    const domain = domainOf(item);
    let results = domain ? await searchEntities(query, domain).catch(() => []) : [];
    if (!results.length) results = await searchTaste(query).catch(() => []);
    return { query, chosen: landingName(query, pickEntity(query, results)), candidates: results.slice(0, 6), weight: 1 } as ResolvedLove;
  }));
  return out.filter((l) => l.chosen);
}

async function scene(city: string, you: LandingName[], them?: LandingName[]): Promise<SceneV2 | null> {
  try {
    const cached = await scenes.get(hash([city, you, them]), async () => {
      const [loves, companion] = await Promise.all([resolve(you), them ? resolve(them) : Promise.resolve(null)]);
      if (loves.length !== you.length || them && companion?.length !== them.length) throw new Error("The example's loves could not all be resolved.");
      const state: ExploreState = { ...emptyState(city), loves, companion: companion?.length ? { loves: companion } : null };
      const input = { responseVersion: 2 as const, state, stateRevision: 0, constraints: [] };
      const { value: analysis, hit } = await analyzeAreas(input);
      if ([...analysis.yours, ...(analysis.theirs ?? [])].some(s => s.status === "unavailable")) throw new Error("The example's cultural signals are temporarily unavailable.");
      const areas = analysis.areas.slice(0, 3);
      const hoods: Neighborhood[] = areas.map(a => ({ id: a.area.id, name: a.area.name, center: a.area.center, score: a.metrics.tasteScore,
        you: a.metrics.you?.score ?? a.metrics.tasteScore, ...(a.metrics.partner ? { them: a.metrics.partner.score } : {}), rank: a.metrics.rank,
        drivers: [], matchedTags: [], vibe: "mixed", samplePlaces: a.anchors.map(v => v.place.name), cellIds: analysis.manifest.areas.find(m => m.identity.id === a.area.id)?.cells.map(c => c.h) ?? [] }));
      return { city, loves, companion, field: analysis.field, hoods, areas,
        meta: resultMeta(input, analysis.manifest, { hit, partial: areas.some(a => a.recommendationStatus !== "recommended"), dataAsOf: analysis.dataAsOf }) };
    });
    return { ...cached.value, meta: { ...cached.value.meta, cache: cached.hit ? "hit" : cached.value.meta.cache } };
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  try { return await withQlooBudget(192, async () => {
    const part = new URL(request.url).searchParams.get("part");
    const jobs: [string, Promise<SceneV2 | null>][] = [];
    if (part !== "rest") jobs.push(["hero", scene(LANDING.hero.city, LANDING.hero.loves)]);
    if (part !== "hero") jobs.push(["reader", scene(LANDING.reader.city, LANDING.reader.loves)], ["owl", scene(LANDING.owl.city, LANDING.owl.loves)], ["pair", scene(LANDING.pair.city, LANDING.pair.you, LANDING.pair.them)]);
    const values = await Promise.all(jobs.map(async ([name, value]) => [name, await value] as const));
    const complete = values.every(([, value]) => value !== null);
    return Response.json({ ...Object.fromEntries(values), ...(part === "hero" ? {} : { cities: null }) }, {
      headers: { "cache-control": complete ? "public, s-maxage=1800, stale-while-revalidate=86400" : "public, s-maxage=30" },
    });
  }); } catch (error) { return errorResponse(error); }
}
