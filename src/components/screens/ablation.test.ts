import { describe, expect, it } from "vitest";
import type { AblationV2 } from "@/shared/contracts-09";
import { counterfactual, movesOutsideTie, moveText } from "./ablation";

const row = (o: Partial<AblationV2>): AblationV2 => ({ areaId: "graca", loveId: "wes", baseRank: 1, withoutRank: 1, deltaTasteScore: 0.02, tieChanged: false, ...o });
const names: Record<string, string> = { wes: "Wes Anderson", rh: "Radiohead", fb: "Fleabag" };
const loveName = (id: string) => (names[id] ? { name: names[id] } : null);

describe("ablation reading (server: tieChanged = rank changed and score gap > 0.01)", () => {
  it("a real move (tieChanged true) is told as the move, never as stable (QA D-008)", () => {
    // the live case: Graça #1, without Wes Anderson #3, delta -0.028, tieChanged true
    const rows = [row({ withoutRank: 3, deltaTasteScore: -0.028, tieChanged: true }), row({ loveId: "rh", withoutRank: 1, tieChanged: false })];
    expect(movesOutsideTie(rows[0])).toBe(true);
    expect(moveText(rows[0])).toEqual({ text: "Falls to #3", tone: "drop" });
    expect(counterfactual(rows, loveName)).toEqual({ moved: true, text: "Without Wes Anderson, this area moves from #1 to #3." });
  });

  it("a rank change inside the tie band (tieChanged false) is level, and the area is stable", () => {
    const rows = [row({ withoutRank: 2, deltaTasteScore: 0.004, tieChanged: false }), row({ loveId: "rh", withoutRank: 1 })];
    expect(movesOutsideTie(rows[0])).toBe(false);
    expect(moveText(rows[0])).toEqual({ text: "About level, #2", tone: "same" });
    expect(counterfactual(rows, loveName)).toEqual({ moved: false, text: "This choice is stable when any one love is removed." });
  });

  it("picks the largest real move, and a rise counts as a move", () => {
    const rows = [row({ withoutRank: 2, tieChanged: true }), row({ loveId: "rh", baseRank: 4, withoutRank: 1, tieChanged: true })];
    expect(moveText(rows[1])).toEqual({ text: "Rises to #1", tone: "rise" });
    expect(counterfactual(rows, loveName)?.text).toBe("Without Radiohead, this area moves from #4 to #1.");
  });

  it("no ranking left without a love, and a love with no signal", () => {
    const rows = [row({ loveId: "rh", withoutRank: null, tieChanged: false, deltaTasteScore: 0.1 }), row({ loveId: "fb", withoutRank: 1, deltaTasteScore: 0 })];
    expect(moveText(rows[0]).text).toBe("No ranking left without it");
    expect(moveText(rows[1]).text).toBe("No signal on this map, changes nothing");
    expect(counterfactual(rows, loveName)?.text).toBe("Radiohead is the only one of your loves with a signal on this map, so the ranking rests on it.");
    expect(counterfactual([], loveName)).toBeNull();
  });
});
