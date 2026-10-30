import { describe, expect, it } from "vitest";
import type { AreaIdentity, PlaceV2 } from "@/shared/contracts-09";
import { coarseSignalRanks, fixedContexts, scoreContext, type ContextCell, type ContextSignal } from "@/server/engine/09/context-ranking";
import { haversine } from "@/server/engine/geo";

const area = (id: string, lon: number): AreaIdentity => ({ id, name: id, aliases: [], center: [lon, 0], geometry: { kind: "circle", radiusM: 650 }, geometryQuality: "approximate" });
const place = (id: string, lon: number): PlaceV2 => ({ id, name: id, lon, lat: 0, category: "coffee", affinity: .1, popularity: .2, why: [], mapsUrl: "https://example.invalid" });
const cells: ContextCell[] = ["a", "b", "c"].map((h, i) => ({ h, center: [i, 0], areaM2: 100 }));
const signal = (query: string, values: number[], weight = 1): ContextSignal => ({ query, weight, status: "ok", contextRanks: new Map(values.map((value, i) => [cells[i].h, value])), contextCells: values.map((_, i) => ({ h: cells[i].h, affinity: .6, popularity: .4 })) });

describe("fixed context aggregation", () => {
  it("fixes locations and ownership independently of taste, popularity and iteration order", () => {
    const areas = [area("west", -.01), area("east", .01)], catalog = [place("one", -.011), place("two", .009)];
    const first = fixedContexts(areas, catalog, [0, 0], 3000);
    const second = fixedContexts([...areas].reverse(), [...catalog].reverse().map(p => ({ ...p, affinity: .99, popularity: .99 })), [0, 0], 3000);
    expect(second.grid).toEqual(first.grid);
    for (const [id, group] of first.areas) {
      expect(second.areas.get(id)).toEqual(group);
      expect(group.every(c => haversine(c.center, areas.find(a => a.id === id)!.center) <= 1600)).toBe(true);
    }
    const all = [...first.areas.values()].flat().map(c => c.h);
    expect(new Set(all).size).toBe(all.length);
  });
  it("preserves real same-domain weights and is invariant to the order of loves", () => {
    const a = signal("A", [.9, .8, .7]), b = signal("B", [.1, .2, .3]);
    const initial = scoreContext(cells, [a, b], .35), reversed = scoreContext(cells, [b, a], .35);
    expect(reversed.score).toBeCloseTo(initial.score, 12);
    const changed = scoreContext(cells, [a, { ...b, weight: .05 }], .35);
    expect(changed.score - initial.score).toBeGreaterThan(.1);
    expect(initial.support.quality).toBe("sufficient");
  });
  it("keeps unknown geography unsupported, rather than presenting it as a confident neutral fit", () => {
    const observed = signal("A", [.9]);
    expect(scoreContext(cells, [observed], .35).support).toMatchObject({ quality: "limited", observedAreaShare: 1 / 3, spatialBlocks: 1 });
    expect(scoreContext(cells, [{ ...observed, status: "unavailable", contextRanks: new Map() }], .35)).toMatchObject({ score: 0, support: { quality: "unavailable", missingSignals: [{ query: "A", reason: "unavailable" }] } });
  });
  it("gives equal signals equal midranks and ignores duplicate cells", () => {
    const values = [{ h: "a", affinity: .5, popularity: .5 }, { h: "b", affinity: .5, popularity: .5 }];
    expect([...coarseSignalRanks([...values, values[0]])]).toEqual([["a", .5], ["b", .5]]);
  });
});
