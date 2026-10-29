import { describe, expect, it } from "vitest";
import { applyPatches } from "@/shared/patches";
import { decodeState, emptyState, encodeState } from "@/lib/state";
import type { ExploreState, ResolvedLove } from "@/shared/contracts";

const love = (q: string, id = q.toUpperCase()): ResolvedLove => ({
  query: q,
  chosen: { id, name: q, domain: "artist" },
  candidates: [],
  weight: 1,
});

describe("applyPatches", () => {
  it("adds, dedupes and caps loves", () => {
    let s = emptyState();
    s = applyPatches(s, Array.from({ length: 10 }, (_, i) => ({ op: "add_love" as const, love: love(`a${i}`) })));
    expect(s.loves).toHaveLength(8);
    s = applyPatches(s, [{ op: "add_love", love: love("A0") }]);
    expect(s.loves).toHaveLength(8);
  });

  it("clamps discovery and clears neighborhood on city change", () => {
    let s: ExploreState = { ...emptyState(), neighborhood: "x" };
    s = applyPatches(s, [{ op: "set_discovery", value: 3 }, { op: "set_city", city: "Berlin" }]);
    expect(s.discovery).toBe(1);
    expect(s.neighborhood).toBeNull();
    expect(s.city).toBe("Berlin");
  });

  it("removes loves by query or name and sets companion", () => {
    let s = applyPatches(emptyState(), [{ op: "add_love", love: love("radiohead") }]);
    s = applyPatches(s, [{ op: "remove_love", query: "RADIOHEAD" }, { op: "set_companion", loves: [love("techno")] }]);
    expect(s.loves).toHaveLength(0);
    expect(s.companion?.loves[0].query).toBe("techno");
  });
});

describe("state url", () => {
  it("round-trips", () => {
    const s = applyPatches(emptyState("México City"), [
      { op: "add_love", love: love("Земфира") },
      { op: "add_refinement", tag: { id: "urn:tag:ambience:qloo:cozy", name: "Cozy", kind: "ambience" } },
      { op: "set_discovery", value: 0.8 },
      { op: "set_days", days: 3 },
      { op: "set_companion", loves: [love("techno")] },
    ]);
    const back = decodeState(encodeState(s));
    expect(back).toEqual({ ...s, loves: s.loves.map((l) => ({ ...l, candidates: [] })), companion: { loves: s.companion!.loves.map((l) => ({ ...l, candidates: [] })) } });
  });

  it("rejects garbage", () => {
    expect(decodeState("%%%")).toBeNull();
    expect(decodeState(null)).toBeNull();
  });
});
