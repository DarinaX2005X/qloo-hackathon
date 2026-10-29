import { beforeEach, describe, expect, it, vi } from "vitest";
import { qlooGet } from "@/server/qloo/client";
import { searchEntities, searchPlaceTags } from "@/server/qloo/search";
import { buildField } from "@/server/engine/field";
import { buildFingerprint } from "@/server/engine/fingerprint";
import { rankNeighborhoods } from "@/server/engine/neighborhoods";
import { findPlaces, matchesCategory, openingHours, placeFromRow } from "@/server/engine/places";
import { TasteField } from "@/shared/contracts";
import { heat, love, state, venue } from "./helpers";

vi.mock("@/server/qloo/client", async (original) => ({ ...await original<typeof import("@/server/qloo/client")>(), qlooGet: vi.fn() }));
const get = vi.mocked(qlooGet);
beforeEach(() => { get.mockReset(); });

describe("search and fingerprint", () => {
  it("selects requested domains, uses priority, trims subtitles and deduplicates", async () => {
    const entity = { entity_id: "director", name: "Director", types: ["urn:entity:author", "urn:entity:person"], properties: { image: { url: "https://image.test" }, short_description: "x".repeat(100) } };
    get.mockResolvedValue({ results: [entity, entity] });
    expect(await searchEntities("Director")).toEqual([{ id: "director", name: "Director", domain: "person", image: "https://image.test", subtitle: "x".repeat(90) }]);
    expect((await searchEntities("Director", "author"))[0].domain).toBe("author");
    expect(get).toHaveBeenLastCalledWith("/search", { query: "Director", types: "urn:entity:author", take: 6 });
  });

  it("only returns place tags and extracts kind from the urn", async () => {
    get.mockResolvedValue({ results: { tags: [
      { id: "urn:tag:ambience:qloo:cozy", name: "Cozy", parents: [{ type: "urn:entity:place" }] },
      { id: "urn:tag:genre:rock", name: "Rock", parents: [{ type: "urn:entity:artist" }] },
    ] } });
    expect(await searchPlaceTags("cozy")).toEqual([{ id: "urn:tag:ambience:qloo:cozy", name: "Cozy", kind: "ambience" }]);
  });

  it("filters utility tags and compares both fingerprints by id", async () => {
    get.mockImplementation(async (_path, params) => ({ results: { tags: [
      { tag_id: "urn:tag:parking:place:free", name: "Free", query: { affinity: 1 } },
      { tag_id: "urn:tag:hotel_rating:place:two_star", name: "Two star", query: { affinity: 1 } },
      { tag_id: "urn:tag:ambience:qloo:cozy", name: "Cozy", query: { affinity: 0.9 } },
      { tag_id: `urn:tag:genre:${params["signal.interests.entities"]}`, name: "Personal", query: { affinity: 0.8 } },
    ] } }));
    const result = await buildFingerprint(state({ companion: { loves: [love("other")] } }));
    expect(result.you).toHaveLength(2);
    expect(result.shared?.map((tag) => tag.name)).toEqual(["Cozy"]);
    expect(result.onlyYou?.[0].id).toBe("urn:tag:genre:artist");
    expect(result.onlyThem?.[0].id).toBe("urn:tag:genre:other");
  });
});

describe("taste field", () => {
  it("weights domain affinities, normalizes, penalizes popularity and reports no-geo loves", async () => {
    get.mockImplementation(async (_path, params) => ({ results: { heatmap: params["signal.interests.entities"] === "game" ? [] : [heat("aaaaaa", 1, 0.5, 1), heat("bbbbbb", 0.5, 1, 0, 0.01)] } }));
    const input = state({ loves: [love("artist"), love("tv", "tv_show", 0.5), love("game", "video_game")], discovery: 0 });
    const result = TasteField.parse(await buildField(input));
    expect(result.cells[0].you).toBe(1);
    expect(result.cells[1].you).toBeCloseTo(0.8);
    expect(result.cells[0].drivers).toEqual({ artist: 0.8, tv_show: 0.2 });
    expect(result.signalsWithoutGeo).toEqual(["game"]);
    expect(result.center).toEqual([0, 0]);
    expect(result.bbox).toEqual([0, 0, 0.01, 0]);
    expect(result.sparse).toBe(true);
    const local = await buildField({ ...input, discovery: 1 });
    expect(local.cells[0].you).toBeCloseTo(0.375);
    expect(local.cells[1].you).toBe(1);
  });

  it("merges refinements and companion cells by hash with missing sides zero", async () => {
    get.mockImplementation(async (_path, params) => ({ results: { heatmap: params["signal.interests.tags"]
      ? [{ location: { geohash: "aaaaaa", latitude: 0, longitude: 0 }, query: { affinity: 1, popularity: 0 } }]
      : params["signal.interests.entities"] === "other" ? [heat("aaaaaa", 0.2), heat("cccccc", 1)]
      : [heat("aaaaaa", 0.5), heat("bbbbbb", 1)] } }));
    const result = await buildField(state({ discovery: 0, refinements: [{ id: "cozy", name: "Cozy", kind: "ambience" }], companion: { loves: [love("other")] } }));
    expect(result.cells).toHaveLength(3);
    for (const cell of result.cells) expect(cell.both).toBe(Math.min(cell.you, cell.them!));
    expect(result.cells.find((cell) => cell.h === "bbbbbb")?.them).toBe(0);
    expect(result.cells.find((cell) => cell.h === "cccccc")?.you).toBe(0);
    expect(result.cells[0].you).toBe(1);
  });

  it("falls back to affinity without per-domain fields and rejects an entirely empty field", async () => {
    get.mockResolvedValue({ results: { heatmap: [{ location: { geohash: "aaaaaa", latitude: 1, longitude: 2 }, query: { affinity: 0.8 } }] } });
    expect((await buildField(state())).cells[0]).toMatchObject({ you: 1, drivers: {} });
    get.mockResolvedValue({ results: { heatmap: [] } });
    await expect(buildField(state())).rejects.toMatchObject({ error: { code: "not_found" } });
  });
});

describe("neighborhoods and places", () => {
  beforeEach(() => {
    get.mockImplementation(async (_path, params) => {
      if (params["filter.type"] === "urn:tag") return { results: { tags: [{ tag_id: "urn:tag:ambience:qloo:cozy", name: "Cozy", query: { affinity: 1 } }] } };
      if (params["filter.type"] === "urn:heatmap") return { results: { heatmap: [heat("aaaaaa", 1, 0, 0, 0), heat("bbbbbb", 0.5, 0, 0, 0.05)] } };
      return { results: { entities: params.page && params.page !== 1 ? [] : [venue("one", "Center", 0), venue("two", "Center", 0.002), venue("three", "Far", 0.05), venue("four", "Far", 0.052), venue("single", "Single", 0.1)] } };
    });
  });

  it("uses median centers, nearby cells, top-three scoring and evidence", async () => {
    const ranked = await rankNeighborhoods(state({ discovery: 0 }));
    expect(ranked.map((n) => n.name)).toEqual(["Center", "Far"]);
    expect(ranked[0]).toMatchObject({ center: [0.001, 0], you: 0.94, score: 0.94, rank: 1, matchedTags: ["Cozy"], vibe: "local", cellIds: ["aaaaaa"], drivers: [{ domain: "artist", share: 1, love: "artist" }] });
    expect(get.mock.calls.filter(([, params]) => params.page)).toHaveLength(3);
  });

  it("gets coffee near the chosen neighborhood and rejects stale ids", async () => {
    const ranked = await rankNeighborhoods(state());
    const result = await findPlaces(state(), ranked[0].id, ["coffee"]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ category: "coffee", why: ["Cozy", "quiet"] });
    const query = get.mock.calls.find(([, params]) => params["filter.location"]);
    expect(query?.[1]).toMatchObject({ "filter.location": "POINT(0.001 0)", "filter.location.radius": 900, take: 8 });
    await expect(findPlaces(state(), "stale")).rejects.toMatchObject({ error: { code: "not_found" } });
  });

  it("normalizes closed days and times, excludes permanently closed places", () => {
    expect(openingHours({ monday: [{ opens: null, closes: null, closed: true }], tuesday: [{ opens: "T10:30:00", closes: "T02:00:00", closed: false }], wednesday: [{ opens: "invalid" }] }))
      .toEqual({ monday: [], tuesday: [{ opens: "10:30", closes: "02:00" }] });
    expect(placeFromRow({ ...venue("x", "N"), properties: { is_closed: true } }, "coffee", [])).toBeNull();
    expect(matchesCategory({ ...venue("bar", "N"), properties: { primary_genre: { id: "urn:tag:genre:place:restaurant:bar" } } }, "coffee")).toBe(false);
    expect(matchesCategory({ tags: [{ id: "urn:tag:genre:place:restaurant" }, { id: "urn:tag:genre:place:book_store" }] }, "food")).toBe(false);
    expect(matchesCategory({ tags: [{ id: "urn:tag:category:place:restaurant" }] }, "food")).toBe(true);
  });
});
