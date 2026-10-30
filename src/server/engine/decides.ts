import { activeLoves, ApiError, DecidesResult, ExploreState, type Neighborhood, type ResolvedLove } from "@/shared/contracts";
import { mapConcurrent } from "./concurrency";
import { rankNeighborhoods } from "./neighborhoods";

export function decidesResult(ranking: Neighborhood[], variants: { love: ResolvedLove; ranking: Neighborhood[] }[]): DecidesResult {
  const neighborhoods = ranking.slice(0, 3).map(({ id, name, rank }) => ({ id, name, rank,
    without: variants.map(({ love, ranking }) => ({ query: love.query, name: love.chosen?.name ?? love.query, rank: ranking.slice(0, 8).find((n) => n.id === id)?.rank ?? null })) }));
  const top = neighborhoods[0];
  // the largest drop decides; "without" keeps profile order, so on a tie the first such love is pivotal
  const fall = (rank: number | null) => rank ?? 9;
  const without = top?.without ?? [];
  const worst = Math.max(1, ...without.map((item) => fall(item.rank)));
  const deciders = worst > 1 ? without.filter((item) => fall(item.rank) === worst) : [];
  const pivotal = deciders[0]?.query ?? null;
  const robust = !pivotal;
  const outOfTop = deciders[0]?.rank === null;
  const summary = !top ? "There are no ranked neighborhoods to compare yet." : !variants.length
    ? `${top.name} is first; there is nothing to compare yet with fewer than two active loves.`
    : deciders.length > 1
      ? `${top.name} ${outOfTop ? "drops out of the top eight" : `falls to #${deciders[0].rank}`} ${orList(deciders.map((item) => `without ${item.name}`))}; no single love holds it up alone.`
    : pivotal ? `${top.name} loses first place without ${deciders[0].name}${outOfTop ? " and drops out of the top eight" : ` (to #${deciders[0].rank})`}.`
    : `${top.name} stays first without any single love.`;
  return { neighborhoods, pivotal, robust, summary };
}

function orList(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
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
