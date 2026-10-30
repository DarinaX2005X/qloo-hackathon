import type { CityScore, ExploreState, ResolvedLove } from "@/shared/contracts";
import { searchEntities, searchTaste } from "@/server/qloo/search";
import { buildField } from "@/server/engine/field";
import { rankNeighborhoods } from "@/server/engine/neighborhoods";
import { compareCities } from "@/server/engine/cities";
import { pickEntity } from "@/lib/pick";
import { emptyState } from "@/lib/state";
import { LANDING, domainOf, landingName, nameOf, type LandingData, type LandingName, type LandingScene } from "@/components/landing/scenes";

// Every map on the landing in one answer the CDN can keep: the page opens on finished terrain
// instead of thirty small requests racing in front of the visitor.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

async function scene(city: string, you: LandingName[], them?: LandingName[]): Promise<LandingScene | null> {
  try {
    const [loves, companion] = await Promise.all([resolve(you), them ? resolve(them) : Promise.resolve(null)]);
    const state: ExploreState = { ...emptyState(city), loves, companion: companion?.length ? { loves: companion } : null };
    const field = await buildField(state);
    const hoods = await rankNeighborhoods(state, field);
    return { city, loves, companion, field, hoods: hoods.slice(0, 3) };
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  const [hero, reader, owl, pair] = await Promise.all([
    scene(LANDING.hero.city, LANDING.hero.loves),
    scene(LANDING.reader.city, LANDING.reader.loves),
    scene(LANDING.owl.city, LANDING.owl.loves),
    scene(LANDING.pair.city, LANDING.pair.you, LANDING.pair.them),
  ]);
  let cities: CityScore[] | null = null;
  if (hero?.loves.length) {
    cities = await compareCities({ ...emptyState(LANDING.hero.city), loves: hero.loves }, LANDING.compare).catch(() => null);
  }
  const body: LandingData = { hero, reader, owl, pair, cities };
  const complete = hero && reader && owl && pair && cities?.every((c) => !c.error);
  return Response.json(body, {
    // a full answer is kept for a day and served stale while it refreshes; a partial one only briefly
    headers: { "cache-control": complete ? "public, s-maxage=86400, stale-while-revalidate=604800" : "public, s-maxage=60" },
  });
}
