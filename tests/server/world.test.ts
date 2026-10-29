import { describe, expect, it } from "vitest";
import { foldCells, heatCell } from "@/server/engine/field";

const raw = (h: string, lat: number, lon: number, affinity: number, popularity = 0.5) =>
  ({ location: { geohash: h, latitude: lat, longitude: lon }, query: { affinity, popularity, entity_artist_affinity: affinity } });

describe("heatmaps anywhere in the world", () => {
  it("accepts the finer cells Qloo returns around a point", () => {
    expect(heatCell(raw("eycs21b", 38.7, -9.1, 0.8))?.h).toBe("eycs21b");
    expect(heatCell(raw("xn76u", 35.6, 139.7, 0.8))).toBeNull();
  });

  it("folds geohash-7 cells into their geohash-6 parent with mean coordinates and scores", () => {
    const cells = [raw("eycs21b", 38.70, -9.10, 1, 1), raw("eycs21c", 38.72, -9.12, 0.5, 0), raw("eycs0rz", 38.6, -9.0, 0.2)]
      .map((row) => heatCell(row)!);
    const folded = foldCells(cells).sort((a, b) => a.h.localeCompare(b.h));
    expect(folded.map((cell) => cell.h)).toEqual(["eycs0r", "eycs21"]);
    expect(folded[1]).toMatchObject({ affinity: 0.75, popularity: 0.5, affinities: { artist: 0.75 } });
    expect(folded[1].lat).toBeCloseTo(38.71);
    expect(folded[1].lon).toBeCloseTo(-9.11);
    expect(folded[0]).toMatchObject({ h: "eycs0r", affinity: 0.2 });
  });
});
