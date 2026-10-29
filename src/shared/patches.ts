import { ExploreState, LIMITS, StatePatch } from "./contracts";

const norm = (s: string) => s.trim().toLowerCase();
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Applies agent or UI patches to a state. Invalid ops are skipped, limits are enforced. */
export function applyPatches(state: ExploreState, ops: StatePatch[]): ExploreState {
  let next: ExploreState = { ...state, loves: [...state.loves], refinements: [...state.refinements] };
  for (const op of ops) {
    switch (op.op) {
      case "set_city":
        if (norm(op.city) !== norm(next.city)) next = { ...next, city: op.city.trim(), neighborhood: null };
        break;
      case "add_love": {
        const dup = next.loves.some(
          (l) =>
            norm(l.query) === norm(op.love.query) ||
            (l.chosen && op.love.chosen && l.chosen.id === op.love.chosen.id),
        );
        if (!dup && next.loves.length < LIMITS.loves) next.loves = [...next.loves, op.love];
        break;
      }
      case "remove_love":
        next.loves = next.loves.filter((l) => norm(l.query) !== norm(op.query) && norm(l.chosen?.name ?? "") !== norm(op.query));
        break;
      case "set_weight":
        next.loves = next.loves.map((l) =>
          norm(l.query) === norm(op.query) || norm(l.chosen?.name ?? "") === norm(op.query) ? { ...l, weight: clamp01(op.weight) } : l,
        );
        break;
      case "add_refinement":
        if (!next.refinements.some((t) => t.id === op.tag.id) && next.refinements.length < LIMITS.refinements)
          next.refinements = [...next.refinements, op.tag];
        break;
      case "remove_refinement":
        next.refinements = next.refinements.filter((t) => t.id !== op.id);
        break;
      case "set_discovery":
        next.discovery = clamp01(op.value);
        break;
      case "set_companion":
        next.companion = op.loves && op.loves.length ? { loves: op.loves.slice(0, LIMITS.companionLoves) } : null;
        break;
      case "set_days":
        next.days = op.days;
        break;
      case "select_neighborhood":
        next.neighborhood = op.id;
        break;
    }
  }
  return next;
}
