import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { ExploreState, Fingerprint, NeighborhoodsResponse, TasteField, type Domain } from "@/shared/contracts";
import { clearQlooCache } from "@/server/qloo/client";
import { searchEntities } from "@/server/qloo/search";
import { buildFingerprint } from "@/server/engine/fingerprint";
import { haversine } from "@/server/engine/geo";
import { findPlaces } from "@/server/engine/places";
import { specificPlaceGenre } from "@/server/engine/taste-tags";
import { POST as fieldRoute } from "@/app/api/field/route";
import { POST as neighborhoodsRoute } from "@/app/api/neighborhoods/route";

export async function coldRequest(handler: (request: Request) => Promise<Response>, state: ExploreState): Promise<{ ms: number; requests: number; body: unknown }> {
  clearQlooCache();
  const nativeFetch = globalThis.fetch;
  let requests = 0;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((...args) => { requests++; return nativeFetch(...args); });
  try {
    const start = performance.now();
    const response = await handler(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(state), headers: { "Content-Type": "application/json" } }));
    const body: unknown = await response.json();
    const ms = Math.round(performance.now() - start);
    expect(response.status, JSON.stringify(body).slice(0, 300)).toBe(200);
    return { ms, requests, body };
  } finally { spy.mockRestore(); }
}

describe.skipIf(process.env.QLOO_LIVE !== "1")("03 live integration measurements", () => {
  it.each([
    { city: "Lisbon", names: [["Radiohead", "artist"], ["Fleabag", "tv_show"], ["Wes Anderson"], ["Haruki Murakami"]] },
    { city: "Berlin", names: [["Charli xcx", "artist"], ["Peggy Gou", "artist"], ["Euphoria", "tv_show"]] },
  ])("measures $city field and neighborhoods with empty caches", async ({ city, names }) => {
    process.loadEnvFile?.(".env.local");
    const loves = await Promise.all(names.map(async ([name, domain]) => {
      const results = await searchEntities(name, domain as Domain | undefined);
      expect(results.length).toBeGreaterThan(0);
      const chosen = results.find((entity) => entity.name.toLowerCase() === name.toLowerCase()) ?? results[0];
      if (name === "Wes Anderson") expect(chosen.domain).toBe("person");
      return { query: name, chosen, candidates: [], weight: 1 };
    }));
    const state = ExploreState.parse({ city, loves, discovery: 0.35, days: 2 });
    const fieldRun = await coldRequest(fieldRoute, state);
    const field = TasteField.parse(fieldRun.body);
    expect(field.cells.length).toBeGreaterThanOrEqual(40);
    expect(field.cells.every((cell) => haversine(field.center, [cell.lon, cell.lat]) <= 7500)).toBe(true);
    const neighborhoodsRun = await coldRequest(neighborhoodsRoute, state);
    const { neighborhoods } = NeighborhoodsResponse.parse(neighborhoodsRun.body);
    expect(neighborhoods.length).toBeGreaterThan(0);
    expect(neighborhoods.length).toBeLessThanOrEqual(8);
    if (neighborhoods.length > 1) expect(neighborhoods[0].score - neighborhoods.at(-1)!.score).toBeGreaterThan(0.15);
    expect(neighborhoods.every((area) => area.matchedTags.length <= 3 && area.name.toLowerCase() !== city.toLowerCase())).toBe(true);
    for (const area of neighborhoods) {
      expect(area.drivers.reduce((sum, driver) => sum + driver.share, 0)).toBeCloseTo(1);
      expect(area.score).toBeGreaterThanOrEqual(0.35);
      expect(area.score).toBeLessThanOrEqual(0.98);
    }
    expect(neighborhoods.every((area) => area.drivers.every((driver) => loves.some((love) => love.chosen.name === driver.love)))).toBe(true);
    const fingerprint = Fingerprint.parse(await buildFingerprint(state));
    expect(fingerprint.you.length).toBeLessThanOrEqual(10);
    expect(fingerprint.you.every((tag) => /^(ambience|decor|genre)$/.test(tag.kind))).toBe(true);
    expect(fingerprint.you.filter((tag) => tag.kind !== "genre").length).toBeLessThanOrEqual(8);
    expect(fingerprint.you.filter((tag) => tag.kind === "genre").length).toBeLessThanOrEqual(3);
    expect(fingerprint.you.filter((tag) => tag.kind === "genre").every((tag) => specificPlaceGenre(tag))).toBe(true);
    expect(fingerprint.you[0].kind).not.toBe("genre");
    const report = {
      measuredAt: new Date().toISOString(), state, field, neighborhoods, fingerprint,
      cold: { field: { ms: fieldRun.ms, requests: fieldRun.requests }, neighborhoods: { ms: neighborhoodsRun.ms, requests: neighborhoodsRun.requests } },
    };
    await mkdir("tests/server/__fixtures__", { recursive: true });
    const path = `tests/server/__fixtures__/03-${city.toLowerCase()}.json`;
    await writeFile(path, JSON.stringify(report, null, 2));
    const places = await findPlaces(state, neighborhoods[0].id, ["coffee", "culture"]);
    expect(places.every((place) => place.why.length <= 4)).toBe(true);
    await writeFile(path, JSON.stringify({ ...report, places }, null, 2));
  }, 180000);
});
