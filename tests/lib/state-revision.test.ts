import { describe, expect, it } from "vitest";
import { inputKey } from "@/components/explore/store";
import { areaFromNeighborhood, legacyRules, visitFromItinerary } from "@/components/explore/adapt";
import { emptyState } from "@/lib/state";
import type { Constraint } from "@/shared/contracts-09";

const radiohead = { query: "Radiohead", chosen: { id: "r", name: "Radiohead", domain: "artist" as const }, candidates: [], weight: 1 };
const noBars: Constraint = { id: "c1", kind: "exclude_type", value: "bar", strength: "hard", source: "user" };
const budget: Constraint = { id: "c2", kind: "budget", value: 2, strength: "hard", source: "user" };

describe("state revision inputs", () => {
  const s = { ...emptyState("Lisbon"), loves: [radiohead] };
  it("changes with loves, weights, city, budget and constraints", () => {
    const k = inputKey(s, []);
    expect(inputKey({ ...s, loves: [{ ...radiohead, weight: 0.5 }] }, [])).not.toBe(k);
    expect(inputKey({ ...s, city: "Berlin" }, [])).not.toBe(k);
    expect(inputKey({ ...s, budget: 2 }, [])).not.toBe(k);
    expect(inputKey(s, [noBars])).not.toBe(k);
  });
  it("does not change with selection, days or constraint order", () => {
    const k = inputKey(s, [noBars, budget]);
    expect(inputKey({ ...s, neighborhood: "x", days: 3 }, [budget, noBars])).toBe(k);
  });
});

describe("legacy adapters", () => {
  it("keep a legacy neighborhood to a neutral rank, without percentile or evidence", () => {
    const n = { id: "a", name: "Alfama", center: [-9.13, 38.71] as [number, number], score: 0.53, you: 0.53, rank: 1, drivers: [], matchedTags: [], vibe: "mixed" as const, samplePlaces: [], cellIds: [] };
    const a = areaFromNeighborhood(n, [n, { ...n, id: "b", rank: 2 }]);
    expect(a.metrics).toMatchObject({ rank: 1, candidateCount: 2, percentile: null, tieBand: false });
    expect(a.recommendationStatus).toBe("needs_checking");
    expect(a.anchors).toEqual([]);
  });
  it("map constraints to the old planner's rules", () => {
    const museums: Constraint = { id: "c3", kind: "exclude_type", value: "museum", strength: "hard", source: "user" };
    expect(legacyRules([noBars, budget, museums])).toEqual({ excludeCategories: ["drinks"], excludeTags: ["museum"], budget: 2 });
  });
  it("never claim an audit for a legacy plan", () => {
    const v = visitFromItinerary({ days: [] }, [noBars]);
    expect(v.audit.hardViolations).toEqual([]);
    expect(v.audit.warnings.join(" ")).toMatch(/not audited/);
    expect(v.constraints).toEqual([noBars]);
  });
});
