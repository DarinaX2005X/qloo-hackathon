import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { EntityRef, Fingerprint, Itinerary, Neighborhood, Place, TasteField } from "@/shared/contracts";
import { searchEntities, searchPlaceTags } from "@/server/qloo/search";
import { buildField, buildFingerprint, findPlaces, rankNeighborhoods, solvePlan } from "@/server/engine";
import { state } from "./helpers";

describe.skipIf(process.env.QLOO_LIVE !== "1")("live Qloo", () => {
  it("runs the Lisbon taste pipeline and records private fixtures", async () => {
    process.loadEnvFile?.(".env.local");
    const [artists, shows, tags] = await Promise.all([searchEntities("Radiohead", "artist"), searchEntities("Fleabag", "tv_show"), searchPlaceTags("cozy")]);
    expect(artists[0].name).toBe("Radiohead");
    expect(EntityRef.parse(artists[0]).image).toBeTruthy();
    expect(tags.some((tag) => tag.kind === "ambience")).toBe(true);
    const input = state({ city: "Lisbon", discovery: 0, loves: [artists[0], shows[0]].map((entity) => ({ query: entity.name, chosen: entity, candidates: [], weight: 1 })) });
    const field = TasteField.parse(await buildField(input));
    expect(field.cells.length).toBeGreaterThanOrEqual(300);
    expect(field.cells.some((cell) => cell.drivers.artist > 0 && cell.drivers.tv_show > 0)).toBe(true);
    const local = await buildField({ ...input, discovery: 1 });
    const changed = local.cells.filter((cell) => cell.popularity > 0.8 && cell.you < field.cells.find((base) => base.h === cell.h)!.you).length;
    expect(changed).toBeGreaterThan(0);
    const neighborhoods = (await rankNeighborhoods(input, field)).map((item) => Neighborhood.parse(item));
    expect(neighborhoods.length).toBeGreaterThan(0);
    expect(neighborhoods[0].drivers.length).toBeGreaterThan(0);
    const places = (await findPlaces(input, neighborhoods[0].id)).map((item) => Place.parse(item));
    expect(places.some((place) => place.category === "coffee")).toBe(true);
    const plan = Itinerary.parse(await solvePlan(input, neighborhoods.slice(0, 2).map((item) => item.id)));
    const ids = plan.days.flatMap((day) => day.stops.map((stop) => stop.place.id));
    expect(new Set(ids).size).toBe(ids.length);
    const fingerprint = Fingerprint.parse(await buildFingerprint({ ...input, companion: { loves: [input.loves[1]] } }));
    const cozy = tags.find((tag) => tag.id === "urn:tag:ambience:qloo:cozy")!;
    const refined = await buildField({ ...input, refinements: [cozy], companion: { loves: [input.loves[1]] } });
    expect(refined.cells.every((cell) => cell.both === Math.min(cell.you, cell.them!))).toBe(true);
    await mkdir("tests/server/__fixtures__", { recursive: true });
    await writeFile("tests/server/__fixtures__/lisbon.json", JSON.stringify({ input, field, local, neighborhoods, places, plan, fingerprint, refined }, null, 2));
    console.log(JSON.stringify({ cells: field.cells.length, highPopularityReduced: changed, neighborhoods: neighborhoods.slice(0, 5).map((item) => item.name), coffee: places.filter((place) => place.category === "coffee").map((place) => place.name), stops: plan.days.map((day) => day.stops.length), missing: plan.days.map((day) => day.missing), fingerprint: fingerprint.you.length, refinedCells: refined.cells.length }));
  }, 180000);
});
