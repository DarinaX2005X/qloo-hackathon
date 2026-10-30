import { activeLoves, ApiError, DecidesResult, ExploreState, type Neighborhood, type ResolvedLove } from "@/shared/contracts";
import { mapConcurrent } from "./concurrency";
import { rankNeighborhoods } from "./neighborhoods";

export function decidesResult(ranking: Neighborhood[], variants: { love: ResolvedLove; ranking: Neighborhood[] }[]): DecidesResult {
  const neighborhoods = ranking.slice(0, 3).map(({ id, name, rank }) => ({ id, name, rank,
    without: variants.map(({ love, ranking }) => ({ query: love.query, name: love.chosen?.name ?? love.query, rank: ranking.slice(0, 8).find((n) => n.id === id)?.rank ?? null })) }));
  const top = neighborhoods[0];
  const drops = [...(top?.without ?? [])].sort((a, b) => (b.rank ?? 9) - (a.rank ?? 9));
  const pivotal = drops.find((item) => item.rank !== 1)?.query ?? null;
  const name = drops.find((item) => item.query === pivotal)?.name;
  const robust = !pivotal;
  const summary = !top ? "There are no ranked neighborhoods to compare yet." : !variants.length
    ? `${top.name} is first; there is nothing to compare yet with fewer than two active loves.`
    : pivotal ? `${top.name} loses first place without ${name}${drops[0].rank === null ? " and drops out of the top eight" : ` (to #${drops[0].rank})`}.`
    : `${top.name} stays first without any single love.`;
  return { neighborhoods, pivotal, robust, summary };
}

export async function whatDecides(input: ExploreState): Promise<DecidesResult> {
  const state = ExploreState.parse(input);
  const loves = activeLoves(state.loves);
  if (!loves.length && !state.refinements.length && !activeLoves(state.companion?.loves ?? []).length) return decidesResult([], []);
  const ranking = await rankNeighborhoods(state);
  if (loves.length < 2 || !ranking.length) return decidesResult(ranking, []);
  const variants = await mapConcurrent(loves, 2, async (love) => ({ love,
    ranking: await rankNeighborhoods({ ...state, loves: state.loves.filter((item) => item !== love), neighborhood: null }).catch((error: unknown) => {
      if (ApiError.safeParse(error).data?.error.code === "not_found") return [];
      throw error;
    }),
  }));
  return DecidesResult.parse(decidesResult(ranking, variants));
}
