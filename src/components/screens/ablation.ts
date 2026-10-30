// Pure reading of the backend's ablations (DecidesResponseV2.ablations), kept apart from the UI so it is unit-tested.
// Server meaning (engine/09/analysis-api.ts): `tieChanged` is true when removing the love changes the area's rank AND
// moves its taste score by more than the 0.01 tie band, i.e. a real move. A rank change with tieChanged=false is a
// reshuffle inside the tie band. `withoutRank: null` means no ranking is left without that love.
import type { AblationV2 } from "@/shared/contracts-09";

/** A real move: the rank changes and the change is outside the tie band (the server's tieChanged). */
export const movesOutsideTie = (a: AblationV2) => a.withoutRank !== null && a.withoutRank !== a.baseRank && a.tieChanged;

/** A love whose removal changes nothing at all has no signal on this map (the backend's delta is exactly 0). */
export const noSignal = (a: AblationV2) => a.withoutRank === a.baseRank && Math.abs(a.deltaTasteScore) < 1e-12;

export type MoveTone = "drop" | "rise" | "same";

/** The short line under one "Without X" row. */
export function moveText(a: AblationV2): { text: string; tone: MoveTone } {
  if (a.withoutRank === null) return { text: "No ranking left without it", tone: "drop" };
  if (noSignal(a)) return { text: "No signal on this map, changes nothing", tone: "same" };
  if (a.withoutRank === a.baseRank) return { text: `Stays #${a.baseRank}`, tone: "same" };
  if (!movesOutsideTie(a)) return { text: `About level, #${a.withoutRank}`, tone: "same" };
  if (a.withoutRank > a.baseRank) return { text: `Falls to #${a.withoutRank}`, tone: "drop" };
  return { text: `Rises to #${a.withoutRank}`, tone: "rise" };
}

/** The one-line counterfactual verdict for an area: the largest real move, the only love with a signal, or stability. */
export function counterfactual(rows: AblationV2[], loveName: (id: string) => { name: string } | null): { text: string; moved: boolean } | null {
  if (!rows.length) return null;
  const only = rows.find((a) => a.withoutRank === null);
  if (only) {
    const name = loveName(only.loveId)?.name ?? "One of your loves";
    return { moved: true, text: `${name} is the only one of your loves with a signal on this map, so the ranking rests on it.` };
  }
  const big = rows.filter(movesOutsideTie).sort((a, b) => Math.abs(b.withoutRank! - b.baseRank) - Math.abs(a.withoutRank! - a.baseRank))[0];
  if (big) {
    const name = loveName(big.loveId)?.name ?? "one of your loves";
    return { moved: true, text: `Without ${name}, this area moves from #${big.baseRank} to #${big.withoutRank}.` };
  }
  return { moved: false, text: "This choice is stable when any one love is removed." };
}
