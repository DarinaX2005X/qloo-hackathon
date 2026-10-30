import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeResult, SpotResult, type Category, type FieldCell, type Neighborhood } from "@/shared/contracts";
import { qlooGet, type QlooRecord } from "@/server/qloo/client";
import { geocode, reverseGeocode } from "@/server/geo/geocode";
import { clearEvidenceCache } from "@/server/engine/evidence";
import { buildField } from "@/server/engine/field";
import { findHome, homeLoves, homePlace, homeState, homeTags, homeTwins, signaturePlaces } from "@/server/engine/home";
import { checkSpot, geohashContains, interpolateSpot, opensLate, placeBrandKey, spotDrivers, spotNeighborhood, spotPercentile, spotWalk } from "@/server/engine/spot";
import { buildHexes } from "@/components/map/hexgrid";
import { CATEGORY_TAGS } from "@/server/engine/places";
import { POST as home } from "@/app/api/home/route";
import { POST as spot } from "@/app/api/spot/route";
import { POST as decides } from "@/app/api/decides/route";
import { love, place, state, venue } from "./helpers";

vi.mock("@/server/qloo/client", async (original) => ({ ...await original<typeof import("@/server/qloo/client")>(), qlooGet: vi.fn() }));
vi.mock("@/server/geo/geocode", async (original) => ({ ...await original<typeof import("@/server/geo/geocode")>(), geocode: vi.fn(), reverseGeocode: vi.fn() }));
const client = vi.mocked(qlooGet);
const area: Neighborhood = { id: "test city:district", name: "District", center: [0, 0], rank: 1, score: 0.8, you: 0.8,
  drivers: [], matchedTags: [], vibe: "local", samplePlaces: [], cellIds: ["s00000"] };
const cells: FieldCell[] = [0, 1, 2, 3, 4].map((i) => ({ h: `s0000${i}`, lon: i * 0.001, lat: 0, you: i / 4, popularity: 0.5, drivers: { artist: 0.75, tv_show: 0.25 } }));

function row(id: string, category: Category, popularity = 0.8): QlooRecord {
  return { ...venue(id, "District"), popularity, tags: [
    { id: CATEGORY_TAGS[category][0], name: category },
    { id: "urn:tag:ambience:qloo:cozy", name: "Cozy" },
    { id: "urn:tag:decor:qloo:vintage", name: "Vintage" },
  ] };
}
beforeEach(() => {
  clearEvidenceCache(); vi.resetAllMocks();
  vi.mocked(geocode).mockResolvedValue({ name: "Street", label: "Street 12", query: "Street", center: [0, 0] });
  vi.mocked(reverseGeocode).mockResolvedValue(null);
  client.mockImplementation(async (_path, params) => {
    if (params["filter.type"] === "urn:heatmap") return { results: { heatmap: cells.map((cell) => ({
      location: { geohash: cell.h, latitude: cell.lat, longitude: cell.lon }, query: { affinity: 0.1 + cell.you * 0.8, popularity: 0.2 },
    })) } };
    if (params["filter.type"] === "urn:tag") return { results: { tags: [{ id: "urn:tag:ambience:qloo:cozy", name: "Cozy", query: { affinity: 0.8 } }] } };
    return { results: { entities: Array.from({ length: 14 }, (_, i) => ({ ...row(`cafe-${i}`, "coffee", 1 - i * 0.02), location: { lat: 0, lon: i * 0.0001 } })) } };
  });
});

describe("07 home composition", () => {
  it("selects varied high-popularity signatures, excluding closed, distant and duplicate places and a second hotel", () => {
    const rows = [row("hotel", "stay", 1), row("hotel2", "stay", 0.99), ...Array.from({ length: 8 }, (_, i) => row(`food${i}`, "food", 0.95 - i * 0.01)),
      row("coffee", "coffee", 0.7), row("bar", "drinks", 0.6), row("museum", "culture", 0.5),
      { ...row("closed", "coffee", 1), properties: { is_closed: true } }, { ...row("far", "culture", 1), location: { lon: 1, lat: 0 } }];
    const picked = signaturePlaces([...rows, rows[0]], [0, 0]).map(homePlace);
    expect(picked).toHaveLength(8);
    expect(picked.map((p) => p.id)).toEqual(["coffee", "food0", "bar", "museum", "hotel", "food1", "food2", "food3"]);
  });
  it("counts taste tags once per place, excluding unrelated tags", () => {
    const tags = homeTags([{ tags: [{ id: "urn:tag:ambience:qloo:cozy", name: "Cozy" }, { id: "urn:tag:decor:qloo:cozy", name: "Cozy" }, { id: "urn:tag:amenity:place:wifi", name: "Wifi" }] }, row("a", "coffee")]);
    expect(tags[0].name).toBe("Cozy"); expect(tags.some((tag) => tag.name === "Wifi")).toBe(false);
  });
  it("preserves eight home signals and all eight personal loves at the requested group weights", () => {
    const places = Array.from({ length: 8 }, (_, i) => homePlace(row(`home-${i}`, "coffee")));
    const original = state({ loves: Array.from({ length: 8 }, (_, i) => love(`taste-${i}`, "artist", i ? 0.5 : 1)) });
    const result = homeState(original, places, 0.4);
    expect(result.loves).toHaveLength(16); expect(original.loves).toHaveLength(8);
    expect(result.loves.slice(0, 8).reduce((sum, l) => sum + l.weight, 0)).toBeCloseTo(1);
    expect(result.loves.slice(8).reduce((sum, l) => sum + l.weight, 0)).toBeCloseTo(0.4);
    expect(homeLoves(places).every((love) => love.chosen?.domain === "place")).toBe(true);
  });
  it("pairs distinct places in the same category by highest target affinity", () => {
    const source = [homePlace(row("home-coffee", "coffee")), homePlace(row("home-food", "food"))];
    const pairs = homeTwins(source, [{ ...row("weak", "coffee"), query: { affinity: 0.1 } }, { ...row("strong", "coffee"), query: { affinity: 0.9 } }, row("meal", "food")]);
    expect(pairs.map((p) => p.target.id)).toEqual(["strong", "meal"]);
    expect(pairs.every((p) => p.source.category === p.target.category)).toBe(true);
  });
  it("blends whole home/personal signals with their relative weights even when both are places", async () => {
    const fallback = client.getMockImplementation()!;
    client.mockImplementation(async (path, params) => {
      if (params["filter.type"] !== "urn:heatmap") return fallback(path, params);
      const reverse = params["signal.interests.entities"] === "personal";
      return { results: { heatmap: cells.map((cell) => ({ location: { geohash: cell.h, latitude: cell.lat, longitude: cell.lon },
        query: { affinity: 0.1 + (reverse ? 1 - cell.you : cell.you) * 0.8, popularity: 0.2 } })) } };
    });
    const home = [love("home", "place")], personal = [love("personal", "place")];
    const a = await buildField(state({ loves: home }));
    const b = await buildField(state({ loves: personal }));
    const blended = await buildField(state({ loves: [...home, ...personal] }), { groups: [{ loves: home, weight: 1 }, { loves: personal, weight: 0.5 }] });
    expect(blended.cells.map((cell) => cell.you)).toEqual(a.cells.map((cell, i) => (cell.you + 0.5 * b.cells[i].you) / 1.5));
  });
  it("builds the real field and ranking with place signals, bounded similarities and shared tags", async () => {
    const result = HomeResult.parse(await findHome({ state: state(), source: { city: "Source", neighborhood: "Old" }, blend: 0 }));
    expect(result.source.places).toHaveLength(8); expect(result.field.cells).toHaveLength(5);
    // Synthetic source and target have identical tag frequencies, so true similarity is exactly 100.
    expect(result.matches[0].similarity).toBe(100);
    expect(result.matches[0].sharedTags).toContain("Cozy"); expect(result.matches[0].twins.length).toBeLessThanOrEqual(3);
    expect(client.mock.calls.some(([, p]) => p["filter.type"] === "urn:heatmap" && String(p["signal.interests.entities"]).split(",").length === 8)).toBe(true);
  });
  it("rejects missing neighborhoods, far source points and empty signatures", async () => {
    vi.mocked(geocode).mockResolvedValue(null);
    await expect(findHome({ state: state(), source: { city: "Source", neighborhood: "Missing" }, blend: 0 })).rejects.toMatchObject({ error: { code: "not_found", message: "We couldn't find Missing in Source." } });
    await expect(findHome({ state: state(), source: { city: "Source", neighborhood: "Far", point: [1, 1] }, blend: 0 })).rejects.toMatchObject({ error: { code: "not_found" } });
    client.mockResolvedValue({ results: { entities: [] } });
    await expect(findHome({ state: state(), source: { city: "Source", neighborhood: "Empty", point: [0, 0] }, blend: 0 })).rejects.toMatchObject({ error: { code: "not_found" } });
  });
});

describe("07 spot composition", () => {
  it("matches map interpolation at rendered hex centres, including the nearest-cell distance cutoff", () => {
    const hexes = buildHexes(cells, { floor: 0 }).features;
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) {
      const ring = hex.geometry.coordinates[0].slice(0, -1);
      const point: [number, number] = [ring.reduce((sum, p) => sum + p[0], 0) / 6, ring.reduce((sum, p) => sum + p[1], 0) / 6];
      expect(interpolateSpot(cells, point)?.score).toBeCloseTo(hex.properties!.you, 8);
    }
    expect(interpolateSpot(cells, [1, 1])).toBeNull();
  });
  it("uses strictly lower cell values for percentile, including ties and empty fields", () => {
    expect(spotPercentile(cells, 0.5)).toBe(40); expect(spotPercentile(cells, 1)).toBe(80); expect(spotPercentile([], 1)).toBe(0);
  });
  it("prefers a containing geohash over a nearer centre, otherwise requires a centre within 1.5 km", () => {
    expect(geohashContains("s00000", [0.001, 0.001])).toBe(true);
    expect(geohashContains("s00000", [-0.001, 0])).toBe(false);
    expect(spotNeighborhood([{ ...area, center: [0.1, 0.1] }, { ...area, id: "other", center: [0.001, 0.001], cellIds: [] }], [0.001, 0.001])?.id).toBe(area.id);
    expect(spotNeighborhood([{ ...area, cellIds: [] }], [0.01, 0])?.id).toBe(area.id);
    expect(spotNeighborhood([area], [1, 1])).toBeNull();
  });
  it("normalizes up to four drivers after allocating domain shares by love weights", () => {
    const drivers = spotDrivers({ artist: 0.6, tv_show: 0.4 }, state({ loves: [love("A"), love("B", "artist", 0.5), love("C", "tv_show")] }));
    expect(drivers.map((d) => d.share).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(drivers.find((d) => d.love === "A")?.share).toBeCloseTo(0.4);
  });
  it("counts before truncation, rounds walking time, deduplicates and excludes distant or zero-affinity places", () => {
    const pool = Array.from({ length: 14 }, (_, i) => place(`coffee${i}`, { lon: 0.001 + i * 0.0001 }));
    const result = spotWalk([...pool, pool[0], place("far", { lon: 0.1 }), place("no-fit", { affinity: 0 })], [0, 0]);
    expect(result.walk).toHaveLength(10); expect(result.counts.coffee).toBe(14); expect(result.walk[0].minutes).toBe(2);
    expect(result.walk[0].place.id).toBe("coffee0");
  });
  it.each(["Café Atlas - Chiado", "CAFÉ  ATLAS (Santos)", "Cafe Atlas | Baixa", "Cafe Atlas—Rossio", "Café Atlas [Centre]", "Cafe Atlas Santa Catarina", "Cafe Atlas branch 2"])("normalizes the brand of %s", (name) => {
    expect(placeBrandKey({ name, neighborhood: "Santa Catarina" })).toBe("cafe atlas");
  });
  it("normalizes punctuation without merging unrelated names or removing internal hyphens", () => {
    expect(placeBrandKey({ name: "O’Briens & Co." })).toBe(placeBrandKey({ name: "O'Briens and Co" }));
    expect(placeBrandKey({ name: "Five-Points Coffee" })).toBe("five points coffee");
    expect(placeBrandKey({ name: "Coffee Lab" })).not.toBe(placeBrandKey({ name: "Coffee House" }));
  });
  it("keeps the nearest eligible branch per brand and counts it once before truncation", () => {
    const hours = { friday: [{ opens: "10:00", closes: "23:00" }] };
    const pool = [
      place("far", { name: "Café Atlas - Santos", category: "food", lon: 0.003, affinity: 1, hours }),
      place("near", { name: "CAFE ATLAS (Chiado)", lon: 0.001, affinity: 0.8, hours }),
      place("unsupported", { name: "Cafe Atlas | Centre", lon: 0, affinity: 0 }),
      ...Array.from({ length: 12 }, (_, i) => place(`independent${i}`, { lon: 0.002 + i * 0.0001 })),
    ];
    const result = spotWalk(pool, [0, 0]);
    expect(result.walk).toHaveLength(10); expect(result.walk[0].place.id).toBe("near");
    expect(result.counts).toEqual({ coffee: 13, food: 0, drinks: 0, culture: 0, openLate: 1 });
    expect(spotWalk([...pool].reverse(), [0, 0])).toEqual(result);
  });
  it.each([["18:00", "23:00", true], ["18:00", "01:00", true], ["01:00", "04:00", true], ["00:00", "24:00", true], ["09:00", "22:59", false]])("counts late hours %s–%s as %s", (opens, closes, expected) => {
    expect(opensLate(place("p", { hours: { monday: [{ opens, closes }] } }))).toBe(expected);
    expect(opensLate(place("unknown"))).toBe(false);
  });
  it("runs the real field/places/ranking pipeline for a geocoded address", async () => {
    const result = SpotResult.parse(await checkSpot({ state: state(), query: "Street 12" }));
    expect(result.label).toBe("Street 12"); expect(result.neighborhood?.name).toBe("District"); expect(result.counts.coffee).toBe(14);
    expect(result.walk).toHaveLength(10); expect(result.verdict).toContain(`${result.percentile}%`);
  });
  it("keeps a typed street label clean and names the missing house number only in the verdict", async () => {
    vi.mocked(geocode).mockResolvedValue({ name: "Street", street: "Street", label: "Street, City", query: "Street", center: [0, 0], streetLevel: true });
    const result = await checkSpot({ state: state(), query: "Street 12" });
    expect(result.label).toBe("Street, City");
    expect(result.verdict).toMatch(/^Street \(the street, house number not found\): better than/);
    expect(reverseGeocode).not.toHaveBeenCalled();
  });
  it("reverse-geocodes an unlabelled pin without moving its point", async () => {
    vi.mocked(reverseGeocode).mockResolvedValue("Pinned Street 12");
    const result = await checkSpot({ state: state(), point: [0.001, 0] });
    expect(result.label).toBe("Pinned Street 12"); expect(result.point).toEqual([0.001, 0]);
    expect(reverseGeocode).toHaveBeenCalledWith([0.001, 0]); expect(geocode).not.toHaveBeenCalled();
    expect(result.verdict).not.toContain("house number not found");
  });
  it("preserves a supplied query label for a pin without another geocoder request", async () => {
    const result = await checkSpot({ state: state(), point: [0.001, 0], query: "My flat" });
    expect(result.label).toBe("My flat"); expect(reverseGeocode).not.toHaveBeenCalled(); expect(geocode).not.toHaveBeenCalled();
  });
  it("falls back to the ranked neighborhood when reverse geocoding has no label", async () => {
    expect((await checkSpot({ state: state(), point: [0.001, 0] })).label).toBe("District");
  });
  it("falls back to Pinned spot when neither a reverse label nor a ranked neighborhood is available", async () => {
    const fallback = client.getMockImplementation()!;
    client.mockImplementation(async (path, params) => params["filter.type"] === "urn:heatmap"
      ? { results: { heatmap: cells.map((cell) => ({ location: { geohash: cell.h, latitude: 0, longitude: 0.04 + cell.lon }, query: { affinity: 0.1 + cell.you * 0.8 } })) } }
      : fallback(path, params));
    const result = await checkSpot({ state: state(), point: [0.041, 0] });
    expect(result.neighborhood).toBeNull(); expect(result.label).toBe("Pinned spot");
  });
  it("rejects an absent address or a supplied point outside the city", async () => {
    vi.mocked(geocode).mockResolvedValue(null);
    await expect(checkSpot({ state: state(), query: "Missing 12" })).rejects.toMatchObject({ error: { code: "not_found", message: "We couldn't find that address in Test City." } });
    await expect(checkSpot({ state: state(), point: [1, 1] })).rejects.toMatchObject({ error: { code: "not_found" } });
  });
});

describe("07 request validation", () => {
  it.each([home, spot, decides])("rejects malformed JSON and missing state with 400", async (handler) => {
    for (const body of ["{", "{}", JSON.stringify({ state: { city: "", loves: [] } })]) {
      const response = await handler(new Request("http://localhost/api/test", { method: "POST", body }));
      expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: { code: "bad_input" } });
    }
  });
  it("rejects missing location, invalid blend and invalid coordinates before any Qloo call", async () => {
    for (const [handler, body] of [[spot, { state: state() }], [spot, { state: state(), point: [181, 0] }],
      [home, { state: state(), source: { city: "Source", neighborhood: "Old" }, blend: 2 }],
      [home, { state: state(), source: { city: "Source", neighborhood: "Old", point: [0, 91] } }]] as const) {
      expect((await handler(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) }))).status).toBe(400);
    }
    expect(client).not.toHaveBeenCalled();
  });
});
