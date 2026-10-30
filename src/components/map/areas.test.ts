import { describe, expect, it } from "vitest";
import type { Neighborhood } from "@/shared/contracts";
import { FICTIONAL_COMPLETE_09 } from "@/shared/fixtures-09";
import { areaLabel, toShortlist } from "./areas";

const hood = (rank: number, samplePlaces: string[]): Neighborhood => ({
  id: `n${rank}`,
  name: `Area ${rank}`,
  center: [-9.14, 38.72],
  score: 0.9 - rank / 10,
  you: 0.5,
  rank,
  drivers: [{ domain: "artist", share: 0.6, love: "Radiohead" }],
  matchedTags: [],
  vibe: "mixed",
  samplePlaces,
  cellIds: [],
});

describe("shortlist adapter", () => {
  it("reads v2 decisions: approximate circles are labelled, anchors keep their evidence, no score leaks", () => {
    const list = toShortlist(FICTIONAL_COMPLETE_09.neighborhoods.areas);
    expect(list.map((a) => a.rank)).toEqual([1, 2, 3]);
    expect(list[0].label).toBe(areaLabel(list[0].name, true));
    expect(list[0].label.startsWith("Around ")).toBe(true);
    expect(list[0].radiusM).toBe(650);
    expect(list[0].anchors[0].venue?.connections.length).toBeGreaterThan(0);
  });

  it("orders legacy neighborhoods by rank, gives the rank of N and never shows hotels as places", () => {
    const list = toShortlist([hood(2, ["Café A"]), hood(1, ["DoubleTree by Hilton Lisbon", "Hotel Florida", "Café do Paço", "Tasca B"])]);
    expect(list.map((a) => a.id)).toEqual(["n1", "n2"]);
    expect(list[0].metrics).toMatchObject({ rank: 1, candidateCount: 2, percentile: null });
    expect(list[0].anchors.map((a) => a.name)).toEqual(["Café do Paço", "Tasca B"]);
    expect(list[0].headline).toContain("Radiohead");
  });

  it("returns an empty list for nothing", () => {
    expect(toShortlist(null)).toEqual([]);
  });
});
