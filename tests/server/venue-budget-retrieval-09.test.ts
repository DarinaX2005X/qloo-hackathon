import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExploreState } from "@/shared/contracts";
import type { Constraint } from "@/shared/contracts-09";
import type { CityManifest } from "@/server/engine/09/manifest";
import { clearQlooCache, qlooRead } from "@/server/qloo/client";
import { loadVenuePool } from "@/server/engine/09/venues-api";

vi.mock("@/server/qloo/client", async original => ({ ...await original<typeof import("@/server/qloo/client")>(), qlooRead: vi.fn() }));
const read = vi.mocked(qlooRead);
const manifest: CityManifest = { cityId: "fictional:budget-city", cityName: "Fictional City", country: "Fictional", center: [0, 0], radiusM: 7500, version: "fictional:budget-v1", fetchedAt: "2026-10-30T00:00:00.000Z", areas: [], catalog: [], rows: [], evidence: [], notes: [] };
const state = ExploreState.parse({ city: "Fictional City", loves: [] });
const budget: Constraint = { id: "fictional:budget", kind: "budget", value: 2, strength: "hard", source: "user" };
const options = { intent: "daily_life" as const, constraints: [budget], center: [0, 0] as [number, number], radiusM: 800 };
const row = (id: string, price?: number) => ({ entity_id: id, name: `Fictional ${id}`, location: { lat: 0, lon: 0 }, query: { affinity: .8 }, properties: { primary_genre: { id: "urn:tag:genre:place:restaurant:coffee_shop" }, price_level: price } });
const response = (rows: ReturnType<typeof row>[], key: string) => ({ value: { results: { entities: rows } }, fetchedAt: manifest.fetchedAt, requestHash: key });
beforeEach(() => { clearQlooCache(); read.mockReset(); });

describe("budget-aware venue retrieval", () => {
  it("retrieves affordable candidates when the taste-first pool is expensive and independently audits both pools", async () => {
    read.mockImplementation(async (_path, query) => query["filter.price_level.max"]
      ? response([row("cheap", 1), row("provider-ignored-filter", 4)], "budget-query")
      : response([row("expensive", 4), row("unknown")], "taste-query"));
    const result = await loadVenuePool(manifest, state, options);
    expect(read).toHaveBeenCalledTimes(4);
    const filtered = read.mock.calls.find(([, query]) => query["filter.price_level.max"] === 2)![1];
    expect(filtered).toMatchObject({ "filter.location": "POINT(0 0)", "filter.location.radius": 800, take: 50 });
    expect(result.venues.map(v => v.place.id).sort()).toEqual(["cheap", "unknown"]);
    expect(result.venues.find(v => v.place.id === "unknown")?.priceStatus).toBe("unknown");
    expect(result.rejectedByReason.budget_exceeded).toBe(2);
    expect(result.evidence.map(e => e.requestHash)).toContain("budget-query");
  });
  it("keeps fixed-ID rechecks restricted to the same IDs", async () => {
    read.mockResolvedValue(response([row("keep", 1), row("unexpected", 1)], "fixed"));
    const result = await loadVenuePool(manifest, state, { ...options, fixedIds: ["keep"] });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][1]["filter.results.entities"]).toBe("keep");
    expect(result.venues.map(v => v.place.id)).toEqual(["keep"]);
  });
  it("reports a failed additional retrieval as unavailable and leaves its partial pool uncached", async () => {
    read.mockImplementation(async (_path, query) => {
      if (query["filter.price_level.max"]) throw new Error("fictional transport failure");
      return response([row("expensive", 4)], "taste-query");
    });
    const result = await loadVenuePool(manifest, state, options);
    expect(result.partial).toBe(true); expect(result.venues).toEqual([]);
    expect(result.unmet.join(" ")).toContain("unavailable");
    await loadVenuePool(manifest, state, options);
    expect(read).toHaveBeenCalledTimes(4);
  });
  it("propagates a complete provider failure instead of claiming no venues passed", async () => {
    read.mockRejectedValue(new Error("fictional provider unavailable"));
    await expect(loadVenuePool(manifest, state, options)).rejects.toThrow("provider unavailable");
  });
});
