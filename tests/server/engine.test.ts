import { beforeEach, describe, expect, it, vi } from "vitest";
import { qlooGet } from "@/server/qloo/client";
import { searchEntities, searchPlaceTags } from "@/server/qloo/search";
import { buildField, heatCell, localPercentiles } from "@/server/engine/field";
import { buildFingerprint, matchedPlaceTags, PLACE_TAG_TYPES } from "@/server/engine/fingerprint";
import { cityCenter } from "@/server/engine/city";
import { percentileRanks } from "@/server/engine/geo";
import { neighborhoodDrivers, rankNeighborhoods } from "@/server/engine/neighborhoods";
import { specificPlaceGenre } from "@/server/engine/taste-tags";
import { findPlaces, matchesCategory, openingHours, placeFromRow } from "@/server/engine/places";
import { activeLoves, TasteField } from "@/shared/contracts";
import { heat, love, state, venue } from "./helpers";

vi.mock("@/server/qloo/client", async (original) => ({ ...await original<typeof import("@/server/qloo/client")>(), qlooGet: vi.fn() }));
const get = vi.mocked(qlooGet);
beforeEach(() => { get.mockReset(); });

export function rawCell(h: string, affinity: number, popularity = 0, lon = 0): Record<string, unknown> {
  return { location: { geohash: h, latitude: 0, longitude: lon }, query: { affinity, popularity } };
}

export const centerResponse = { results: { entities: [venue("origin", "City", 0)] } };

describe("search and fingerprint", () => {
  it("prefers person over author even during author search; standalone authors remain authors", async () => {
    const entity = { entity_id: "director", name: "Director", types: ["urn:entity:author", "urn:entity:person"], properties: { image: { url: "https://image.test" }, short_description: "x".repeat(100) } };
    get.mockResolvedValue({ results: [entity, entity] });
    expect(await searchEntities("Director")).toEqual([{ id: "director", name: "Director", domain: "person", image: "https://image.test", subtitle: "x".repeat(90) }]);
    expect((await searchEntities("Director", "author"))[0].domain).toBe("person");
    get.mockResolvedValue({ results: [{ ...entity, types: ["urn:entity:author"] }] });
    expect((await searchEntities("Writer", "author"))[0].domain).toBe("author");
    expect(get).toHaveBeenLastCalledWith("/search", { query: "Writer", types: "urn:entity:author", take: 6 });
    get.mockResolvedValue({ results: [{ ...entity, types: ["urn:entity:author"] }, { ...entity, types: ["urn:entity:person"] }] });
    expect((await searchEntities("Director"))[0].domain).toBe("person");
    expect((await searchEntities("Director", "author"))[0].domain).toBe("person");
  });

  it("only returns place tags and extracts kind from the urn", async () => {
    get.mockResolvedValue({ results: { tags: [
      { id: "urn:tag:ambience:qloo:cozy", name: "Cozy", parents: [{ type: "urn:entity:place" }] },
      { id: "urn:tag:genre:rock", name: "Rock", parents: [{ type: "urn:entity:artist" }] },
    ] } });
    expect(await searchPlaceTags("cozy")).toEqual([{ id: "urn:tag:ambience:qloo:cozy", name: "Cozy", kind: "ambience" }]);
  });

  it("adapts Qloo videogame spelling without changing the public domain", async () => {
    get.mockResolvedValue({ results: [{ entity_id: "game", name: "Game", types: ["urn:entity:videogame"] }] });
    expect((await searchEntities("Game", "video_game"))[0].domain).toBe("video_game");
    expect(get).toHaveBeenLastCalledWith("/search", { query: "Game", types: "urn:entity:videogame", take: 6 });
    expect(heatCell({ location: { geohash: "aaaaaa", latitude: 0, longitude: 0 }, query: { entity_videogame_affinity: 0.7 } })?.affinities).toEqual({ video_game: 0.7 });
  });

  it("requests place taste tags, deduplicates names and caps each comparison set", async () => {
    get.mockImplementation(async (_path, params) => {
      const theirs = params["signal.interests.entities"] === "other";
      return { results: { tags: [
        { tag_id: "urn:tag:motif:qloo:poverty", name: "Poverty", query: { affinity: 1 } },
        { tag_id: "urn:tag:hotel_rating:place:two_star", name: "Two star", query: { affinity: 1 } },
        { tag_id: `urn:tag:${theirs ? "decor" : "ambience"}:qloo:intimate`, name: theirs ? "INTIMATE" : "Intimate", query: { affinity: 0.99 } },
        { tag_id: "urn:tag:decor:qloo:intimate", name: "Intimate", query: { affinity: 0.98 } },
        ...Array.from({ length: 9 }, (_, i) => ({ tag_id: `urn:tag:decor:qloo:${theirs ? "theirs" : "yours"}${i}`, name: `${theirs ? "Theirs" : "Yours"}${i}`, query: { affinity: 0.97 - i / 100 } })),
        ...Array.from({ length: 12 }, (_, i) => ({ tag_id: `urn:tag:genre:place:${theirs ? "theirs" : "yours"}${i}`, name: `${theirs ? "Theirs" : "Yours"}${i}`, query: { affinity: 0.9 - i / 100 } })),
      ] } };
    });
    const result = await buildFingerprint(state({ companion: { loves: [love("other")] } }));
    expect(result.you).toHaveLength(10);
    expect(result.them).toHaveLength(10);
    expect(result.shared?.map((tag) => tag.name)).toEqual(["Intimate"]);
    expect(result.onlyYou).toHaveLength(6);
    expect(result.onlyThem).toHaveLength(6);
    expect(result.onlyYou?.every((tag) => tag.name.startsWith("Yours"))).toBe(true);
    expect(get.mock.calls.every(([, params]) => PLACE_TAG_TYPES.some((type) => type === params["filter.tag.types"]))).toBe(true);
    expect(get).toHaveBeenCalledTimes(6);
    expect(result.you.slice(0, 8).every((tag) => tag.kind === "ambience" || tag.kind === "decor")).toBe(true);
  });

  it("matches by name across namespaces, counts venue frequency and ignores service tags", () => {
    const desired = ["Rare", "Cozy", "Intimate", "Vintage", "Rustic"].map((name) => ({ id: `urn:tag:decor:qloo:${name.toLowerCase()}`, name, kind: "decor" }));
    const rows = [
      { tags: desired.map((tag) => ({ id: tag.id, name: tag.name })) },
      { tags: [{ id: "urn:tag:ambience:qloo:cozy", name: "COZY" }, { id: "urn:tag:decor:qloo:cozy", name: "Cozy" }] },
      { tags: [{ id: "urn:tag:ambience:place:cozy", name: "Cozy" }] },
      { tags: [{ id: "urn:tag:parking:place:rare", name: "Rare" }] },
    ];
    expect(matchedPlaceTags(rows, desired)).toEqual(["Cozy", "Rare", "Intimate"]);
  });

  it("keeps specific venues while excluding generic genres and national cuisines", () => {
    for (const name of ["Restaurant", "Bar", "Cafe", "Coffee", "Tourist attraction", "Hotel", "Museum", "Shopping", "Park", "European", "American", "Italian", "French", "Mediterranean", "British", "Asian", "Portuguese", "German", "Spanish", "Mexican", "Japan", "Japanese restaurant", "Modern European", "New American"])
      expect(specificPlaceGenre({ id: `urn:tag:genre:place:${name}`, name, kind: "genre" }), name).toBe(false);
    for (const name of ["Live music bar", "Art gallery", "Gastropub", "Wine bar", "Cocktail bar", "Vinyl record store", "Book store", "Jazz club", "Concept store"])
      expect(specificPlaceGenre({ id: `urn:tag:genre:place:${name}`, name, kind: "genre" }), name).toBe(true);
    expect(specificPlaceGenre({ id: "urn:tag:genre:place:regional", name: "Regional", kind: "genre" }, { subtype: "urn:tag:cuisine" })).toBe(false);
  });

  it("prioritizes ambience matches over a more frequent genre and leaves no-match results empty", () => {
    const desired = [{ id: "urn:tag:genre:place:art_gallery", name: "Art gallery", kind: "genre" }, { id: "urn:tag:decor:qloo:cozy", name: "Cozy", kind: "decor" }];
    const rows = [{ tags: desired }, { tags: [desired[0]] }, { tags: [desired[0]] }];
    expect(matchedPlaceTags(rows, desired)).toEqual(["Cozy", "Art gallery"]);
    expect(matchedPlaceTags([{ tags: [{ id: "urn:tag:genre:place:restaurant", name: "Restaurant" }] }], desired)).toEqual([]);
    expect(placeFromRow({ ...venue("unmatched", "N"), tags: [], properties: { keywords: [{ name: "Coffee", count: 10 }] } }, "coffee", desired)?.why).toEqual([]);
  });
});

describe("city focus and percentiles", () => {
  it("uses the 30 unsignalled popular places and robust coordinate medians", async () => {
    get.mockResolvedValue({ results: { entities: [venue("a", "A", -0.01), venue("b", "B", 0.01), venue("outlier", "Far", 1)] } });
    expect(await cityCenter("Test City")).toEqual([0.01, 0]);
    expect(get).toHaveBeenCalledWith("/v2/insights", { "filter.type": "urn:entity:place", "filter.location.query": "Test City", take: 30 });
  });

  it("assigns average ranks to ties without inventing differences on a plateau", () => {
    expect(percentileRanks([4, 1, 2, 2])).toEqual([0.875, 0.125, 0.5, 0.5]);
    expect(percentileRanks([1, 1, 1])).toEqual([0.5, 0.5, 0.5]);
    const cells = [heatCell(rawCell("aaaaaa", 0.5))!, heatCell(rawCell("bbbbbb", 1))!, heatCell(rawCell("cccccc", 0.8))!];
    expect([...localPercentiles(cells, new Set(["aaaaaa", "cccccc"]))]).toEqual([["aaaaaa", 0.25], ["cccccc", 0.75]]);
  });

  it.each([39, 40])("uses the 15km fallback only when fewer than 40 cells lie inside 7.5km (%s)", async (count) => {
    const cells = [...Array.from({ length: count }, (_, i) => rawCell(String(i).padStart(6, "0"), 0.5, 0, i * 0.0001)), rawCell("farfar", 1, 0, 0.1), rawCell("beyond", 1, 0, 0.2)];
    get.mockImplementation(async (_path, params) => params["filter.type"] === "urn:entity:place" ? centerResponse : { results: { heatmap: cells } });
    const result = await buildField(state());
    expect(result.cells.some((cell) => cell.h === "farfar")).toBe(count < 40);
    expect(result.cells.some((cell) => cell.h === "beyond")).toBe(false);
    expect(result.center).toEqual([0, 0]);
    expect(result.bbox[2]).toBeCloseTo(count < 40 ? 0.1 : 0.0039);
  });
});

describe("taste field", () => {
  it("uses weighted individual percentiles, domain contribution shares and discovery", async () => {
    get.mockImplementation(async (_path, params) => {
      if (params["filter.type"] === "urn:entity:place") return centerResponse;
      const id = params["signal.interests.entities"];
      const rows = id === "game" ? [] : id === "tv"
        ? [rawCell("aaaaaa", 0.5, 1), rawCell("bbbbbb", 1, 0, 0.01)]
        : [rawCell("aaaaaa", 1, 1), rawCell("bbbbbb", 0.5, 0, 0.01)];
      return { results: { heatmap: rows } };
    });
    const input = state({ loves: [love("artist"), love("tv", "tv_show", 0.5), love("game", "video_game")], discovery: 0 });
    const result = TasteField.parse(await buildField(input));
    expect(result.cells[0].you).toBe(1);
    expect(result.cells[1].you).toBeCloseTo(1 / 3);
    expect(result.cells[0].drivers.artist).toBeCloseTo(6 / 7);
    expect(result.cells[0].drivers.tv_show).toBeCloseTo(1 / 7);
    expect(result.signalsWithoutGeo).toEqual(["game"]);
    expect(result.bbox).toEqual([0, 0, 0.01, 0]);
    expect(result.sparse).toBe(true);
    const local = await buildField({ ...input, discovery: 1 });
    expect(local.cells[0].you).toBeCloseTo(0.9);
    expect(local.cells[1].you).toBe(1);
    expect(get.mock.calls.some(([, params]) => params["signal.interests.entities"] === "artist,game,tv")).toBe(true);
  });

  it("ranks tags locally and preserves missing companion support", async () => {
    get.mockImplementation(async (_path, params) => params["filter.type"] === "urn:entity:place" ? centerResponse : ({ results: { heatmap: params["signal.interests.tags"]
      ? [rawCell("aaaaaa", 1)] : params["signal.interests.entities"] === "other" ? [rawCell("aaaaaa", 0.2), rawCell("cccccc", 1)]
      : [rawCell("aaaaaa", 0.5), rawCell("bbbbbb", 1)] } }));
    const result = await buildField(state({ discovery: 0, refinements: [{ id: "cozy", name: "Cozy", kind: "ambience" }], companion: { loves: [love("other")] } }));
    expect(result.cells).toHaveLength(3);
    for (const cell of result.cells) expect(cell.both).toBe(Math.min(cell.you, cell.them!));
    expect(result.cells.find((cell) => cell.h === "bbbbbb")?.them).toBe(0);
    expect(result.cells.find((cell) => cell.h === "cccccc")?.you).toBe(0);
    expect(result.cells[0].you).toBeCloseTo((0.65 * 0.25 + 0.35 * 0.5) / (0.65 * 0.75));
  });

  it("supports individual affinity without domain fields and rejects empty maps", async () => {
    get.mockImplementation(async (_path, params) => params["filter.type"] === "urn:entity:place" ? centerResponse : { results: { heatmap: [rawCell("aaaaaa", 0.8)] } });
    expect((await buildField(state())).cells[0]).toMatchObject({ you: 1, drivers: { artist: 1 } });
    get.mockImplementation(async (_path, params) => params["filter.type"] === "urn:entity:place" ? centerResponse : { results: { heatmap: [] } });
    await expect(buildField(state())).rejects.toMatchObject({ error: { code: "not_found" } });
  });

  it("locally ranks the combined signal while deriving explanations from individual maps", async () => {
    get.mockImplementation(async (_path, params) => {
      if (params["filter.type"] === "urn:entity:place") return centerResponse;
      return { results: { heatmap: params["signal.interests.entities"] === "first,second"
        ? [rawCell("aaaaaa", 0.2), rawCell("bbbbbb", 0.9)]
        : [rawCell("aaaaaa", 1), rawCell("bbbbbb", 0.1)] } };
    });
    const field = await buildField(state({ loves: [love("first"), love("second")], discovery: 0 }));
    expect(field.cells[0].you).toBeCloseTo(1 / 3);
    expect(field.cells[1].you).toBe(1);
    expect(field.cells[0].drivers).toEqual({ artist: 1 });
  });

  it("detects a missing entity even when another love has the same domain", async () => {
    get.mockImplementation(async (_path, params) => params["filter.type"] === "urn:entity:place" ? centerResponse : ({ results: { heatmap: params["signal.interests.entities"] === "missing" ? [] : [rawCell("aaaaaa", 1)] } }));
    const result = await buildField(state({ loves: [love("artist"), love("missing")] }));
    expect(result.signalsWithoutGeo).toEqual(["missing"]);
    expect(result.cells[0].drivers).toEqual({ artist: 1 });
  });
});

describe("neighborhoods and places", () => {
  beforeEach(() => {
    get.mockImplementation(async (_path, params) => {
      if (params["filter.type"] === "urn:tag") return { results: { tags: [{ tag_id: "urn:tag:ambience:qloo:cozy", name: "Cozy", query: { affinity: 1 } }] } };
      if (params["filter.type"] === "urn:heatmap") return { results: { heatmap: [heat("aaaaaa", 1, 0, 0, 0), heat("bbbbbb", 0.5, 0, 0, 0.05)] } };
      if (!params["signal.interests.entities"]) return centerResponse;
      return { results: { entities: params.page && params.page !== 1 ? [] : [venue("one", "Center", 0), venue("two", "Center", 0.002), venue("center-mid", "Center", 0.001), venue("three", "Far", 0.05), venue("four", "Far", 0.052), venue("far-mid", "Far", 0.051), venue("single", "Single", 0.1), venue("small1", "Small", 0.08), venue("small2", "Small", 0.081), ...[1, 2, 3].map((n) => venue(`city${n}`, " TEST CITY ", 0))] } };
    });
  });

  it("uses median centers and raw scores to rank, then displays neighborhood percentiles", async () => {
    const ranked = await rankNeighborhoods(state({ discovery: 0 }));
    expect(ranked.map((n) => n.name)).toEqual(["Center", "Far"]);
    expect(ranked[0]).toMatchObject({ center: [0.001, 0], you: 0.94, score: 0.8225, rank: 1, matchedTags: ["Cozy"], vibe: "local", cellIds: ["aaaaaa"], drivers: [{ domain: "artist", share: 1, love: "artist" }] });
    expect(ranked[1].score).toBeCloseTo(0.5075);
    expect(get.mock.calls.filter(([, params]) => params.page)).toHaveLength(3);
  });

  it("gets coffee near the chosen neighborhood and rejects stale ids", async () => {
    const ranked = await rankNeighborhoods(state());
    const result = await findPlaces(state(), ranked[0].id, ["coffee"]);
    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({ category: "coffee", why: ["Cozy", "quiet"] });
    const query = get.mock.calls.find(([, params]) => params["filter.location"]);
    expect(query?.[1]).toMatchObject({ "filter.location": "POINT(0.001 0)", "filter.location.radius": 900, take: 8 });
    await expect(findPlaces(state(), "stale")).rejects.toMatchObject({ error: { code: "not_found" } });
  });

  it("explains two loves of one domain separately and retains couple fairness tie-breaking", async () => {
    get.mockImplementation(async (_path, params) => {
      if (params["filter.type"] === "urn:tag") return { results: { tags: [] } };
      if (params["filter.type"] === "urn:heatmap") return { results: { heatmap: params["signal.interests.entities"] === "first"
        ? [rawCell("aaaaaa", 1), rawCell("bbbbbb", 0.1, 0, 0.05)] : [rawCell("aaaaaa", 0.1), rawCell("bbbbbb", 1, 0, 0.05)] } };
      return { results: { entities: params.page === 1 ? [venue("a1", "A", 0, 0.5), venue("a2", "A", 0.002, 0.5), venue("a3", "A", 0.001, 0.5), venue("b1", "B", 0.05, 0.5), venue("b2", "B", 0.052, 0.5), venue("b3", "B", 0.051, 0.5)] : [] } };
    });
    const field: TasteField = { city: "Test City", center: [0, 0], bbox: [0, 0, 0.05, 0], sparse: true, signalsWithoutGeo: [], cells: [
      { h: "aaaaaa", lon: 0, lat: 0, you: 0.5, them: 0.6, both: 0.5, popularity: 0, drivers: {} },
      { h: "bbbbbb", lon: 0.05, lat: 0, you: 1, them: 0.5, both: 0.5, popularity: 0, drivers: {} },
    ] };
    const result = await rankNeighborhoods(state({ loves: [love("first"), love("second")], companion: { loves: [love("other")] } }), field);
    expect(result.map((area) => area.name)).toEqual(["B", "A"]);
    expect(result[0].score).toBeCloseTo(0.665);
    expect(result[1].score).toBe(result[0].score);
    expect(result[0].drivers).toEqual([{ domain: "artist", love: "second", share: 1 }]);
    expect(result[1].drivers[0].love).toBe("first");
  });

  it("measures lift against each city median and falls back to affinities on a flat field", () => {
    const [first, second] = activeLoves([love("first"), love("second")]);
    const series = [{ love: first, values: new Map([["a", 0.5], ["b", 0.6], ["c", 0.9]]) }, { love: second, values: new Map([["a", 0.1], ["b", 0.2], ["c", 0.8]]) }];
    const lifted = neighborhoodDrivers(series, ["a", "b", "c"], ["c"]);
    expect(lifted[0].love).toBe("second");
    expect(lifted[0].share).toBeCloseTo(2 / 3);
    expect(lifted[1].share).toBeCloseTo(1 / 3);
    const flat = neighborhoodDrivers(series, ["a", "b", "c"], ["b"]);
    expect(flat[0]).toMatchObject({ love: "first" });
    expect(flat[0].share).toBeCloseTo(0.75);
    expect(flat[1].share).toBeCloseTo(0.25);
  });

  it("limits why to taste matches and two useful keywords without duplicate names", () => {
    const row = { ...venue("x", "N"), tags: [
      { id: "urn:tag:ambience:qloo:intimate", name: "Intimate" }, { id: "urn:tag:decor:qloo:intimate", name: "INTIMATE" },
      { id: "urn:tag:inclusivity:place:women_owned", name: "Women owned" },
    ], properties: { keywords: [{ name: "Parking", count: 99 }, { name: "Intimate", count: 50 }, { name: "Coffee", count: 10 }, { name: "Garden", count: 9 }, { name: "Cakes", count: 8 }] } };
    expect(placeFromRow(row, "coffee", [{ id: "urn:tag:decor:qloo:intimate", name: "Intimate", kind: "decor" }])?.why).toEqual(["Intimate", "Coffee", "Garden"]);
  });

  it("normalizes hours and rejects misleading categories or permanently closed places", () => {
    expect(openingHours({ monday: [{ opens: null, closes: null, closed: true }], tuesday: [{ opens: "T10:30:00", closes: "T02:00:00", closed: false }], wednesday: [{ opens: "invalid" }] }))
      .toEqual({ monday: [], tuesday: [{ opens: "10:30", closes: "02:00" }] });
    expect(placeFromRow({ ...venue("x", "N"), properties: { is_closed: true } }, "coffee", [])).toBeNull();
    expect(matchesCategory({ ...venue("bar", "N"), properties: { primary_genre: { id: "urn:tag:genre:place:restaurant:bar" } } }, "coffee")).toBe(false);
    expect(matchesCategory({ tags: [{ id: "urn:tag:genre:place:restaurant" }, { id: "urn:tag:genre:place:book_store" }] }, "food")).toBe(false);
    expect(matchesCategory({ tags: [{ id: "urn:tag:category:place:restaurant" }] }, "food")).toBe(true);
  });
});
