import { describe, expect, it } from "vitest";
import { trimResponse } from "@/server/qloo/client";
import { entityResolution, lexicalAgreement } from "@/server/qloo/search";
import { areaMembership, encodeGeohash, geohashBounds, pointInArea } from "@/server/engine/09/geometry";
import { nativeCells, orderMetrics, scorePerson, type WeightedSignal } from "@/server/engine/09/ranking";
import { venueEligibility, intentRole, dedupePlaces, rowPlace } from "@/server/engine/09/eligibility";
import type { CityManifest, ManifestArea } from "@/server/engine/09/manifest";
import type { AreaIdentity, Constraint, PlaceV2 } from "@/shared/contracts-09";
import { catalogStreetPoint } from "@/server/engine/09/address-api";

const identity: AreaIdentity = { id: "test:area", name: "Fictional Area", aliases: [], center: [0, 0], geometry: { kind: "circle", radiusM: 650 }, geometryQuality: "approximate" };
const area: ManifestArea = { identity, cells: ["a", "b", "c", "d"].map((h, i) => ({ h, areaM2: 100, block: String(i) })), venueIds: [], neutralScore: .5 };
const signal = (id: string, ranks: [string, number][], status: WeightedSignal["status"] = "ok", weight = 1): WeightedSignal => ({ entityId: id, status, cells: [], evidence: [], query: id, weight, domain: "artist", ranks: new Map(ranks) });
const manifest: CityManifest = { cityId: "test:city", cityName: "Fictional City", country: "Test", center: [0, 0], radiusM: 7500, version: "test:manifest", fetchedAt: "2026-10-30T00:00:00.000Z", areas: [area, { ...area, identity: { ...identity, id: "test:area2" } }], catalog: [], rows: [], evidence: [], notes: [] };
function place(primary: string, tags: string[] = [], name = "Fictional venue"): PlaceV2 {
  return { id: "test:place", name, category: "coffee", lat: 0, lon: 0, affinity: .99, popularity: .99, why: [], mapsUrl: "https://example.invalid", primaryGenre: primary, classifications: [primary, ...tags], tags: [] };
}
const hard = (kind: Constraint["kind"], value: string | number): Constraint => ({ id: `test:${kind}`, kind, value, strength: "hard", source: "user" });

describe("address street estimates", () => {
  it("requires at least two nearby matching addresses and never claims the requested house", () => {
    const a = { ...place("cafe"), id: "fictional:a", address: "R. da Rosa 148, Fictional City", lon: .001 };
    const b = { ...place("restaurant"), id: "fictional:b", address: "Rua da Rosa 176, Fictional City", lon: .003 };
    const found = catalogStreetPoint("Rua da Rosa 120", { ...manifest, catalog: [a, b] });
    expect(found?.label).toBe("Rua da Rosa, Fictional City (street estimate)");
    expect(found?.entityIds).toEqual(["fictional:a", "fictional:b"]);
    expect(catalogStreetPoint("Rua da Rosa 120", { ...manifest, catalog: [a] })).toBeNull();
    expect(catalogStreetPoint("Rua da Rosa 120", { ...manifest, catalog: [a, { ...b, lon: 10 }] })).toBeNull();
    expect(catalogStreetPoint("Rua da Rosa 120", { ...manifest, catalog: [a, { ...b, address: "Rua Augusto Rosa 176" }] })).toBeNull();
  });
});

describe("stage 09 fixed geometry and scoring", () => {
  it("enumerates the same native area geometry independently of observed cells", () => {
    const cells = areaMembership(identity, [0, 0], 7500);
    expect(cells).toEqual(areaMembership(identity, [0, 0], 7500));
    expect(cells.length).toBeGreaterThan(40);
    const relativeError = Math.abs(cells.reduce((s, c) => s + c.areaM2, 0) / (Math.PI * 650 ** 2) - 1);
    expect(relativeError).toBeLessThan(.005);
    expect(pointInArea([0, 0], identity)).toBe(true);
    expect(pointInArea([1, 1], identity)).toBe(false);
  });
  it("retains geohash-7 and native rank, with an explicit affinity fallback and no duplicate weighting", () => {
    const h = encodeGeohash([.001, .001]), bounds = geohashBounds(h)!;
    expect(bounds[0]).toBeLessThanOrEqual(.001); expect(bounds[2]).toBeGreaterThan(.001);
    const raw = { location: { geohash: h }, query: { affinity_rank: .8, affinity: .2, popularity: .9 } };
    expect(nativeCells(Array(10).fill(raw), [0, 0], 7500)).toEqual(nativeCells([raw], [0, 0], 7500));
    expect(nativeCells([raw], [0, 0], 7500)[0]).toMatchObject({ h, value: .8, kind: "affinity_rank" });
    expect(nativeCells([{ ...raw, query: { affinity: .2 } }], [0, 0], 7500)[0]).toMatchObject({ value: .2, kind: "affinity" });
    expect(nativeCells([{ ...raw, query: { affinity: Number.NaN } }], [0, 0], 7500)).toEqual([]);
  });
  it("shrinks using area coverage and spatial blocks, rather than count or popularity", () => {
    const scored = scorePerson(area, [signal("one", [["a", 1], ["b", 1], ["c", 1], ["d", 1]])]);
    expect(scored.score).toBeCloseTo(.5 + 4 / 7 * .5, 12);
    expect(scored.support).toMatchObject({ quality: "sufficient", observedAreaShare: 1, spatialBlocks: 4 });
  });
  it("missing transport and empty provider signals remain distinct and never mean dislike", () => {
    const missing = scorePerson(area, [signal("network", [], "unavailable"), signal("empty", [], "no_signal")]);
    expect(missing.score).toBe(.5);
    expect(missing.support.quality).toBe("unavailable");
    expect(missing.support.missingSignals).toEqual([{ query: "network", reason: "unavailable" }, { query: "empty", reason: "no_signal" }]);
    expect(scorePerson(area, [signal("other-region", [["elsewhere", .9]])]).support.quality).toBe("limited");
  });
  it("ties share scores and no percentile appears without five supported areas", () => {
    const m = orderMetrics(manifest, [signal("one", area.cells.map(c => [c.h, .5]))], null);
    expect([...m.values()].every(v => v.percentile === null && v.tieBand && v.candidateCount === 2)).toBe(true);
    expect([...m.values()].map(v => v.tasteScore)).toEqual([.5, .5]);
  });
  it("couples use the minimum and expose the unsupported partner", () => {
    const m = [...orderMetrics(manifest, [signal("you", area.cells.map(c => [c.h, .9]))], [signal("them", [], "unavailable")]).values()][0];
    expect(m.tasteScore).toBe(Math.min(m.you!.score, m.partner!.score));
    expect(m.support.quality).toBe("unavailable");
  });
});

describe("stage 09 eligibility across every result role", () => {
  it("secondary coffee tags cannot turn retail, bars or museums into cafes", () => {
    for (const primary of ["supermarket", "convenience_store", "gas_station", "restaurant:bar", "art_museum", "ice_cream_shop", "clothing_store"]) {
      const p = place(primary, ["coffee_shop", "restaurant"]);
      expect(venueEligibility(p, "coffee").allowed, primary).toBe(false);
    }
    expect(intentRole("daily_life", place("art_museum", ["coffee_shop", "restaurant"]))).toBe("culture");
  });
  it("nearby attractions do not become venue types, while conflicting raw keywords remain visible", () => {
    const row = { entity_id: "fictional:id", name: "Fictional Café", location: { lat: 0, lon: 0 }, properties: { primary_genre: { id: "urn:tag:genre:place:restaurant:cafe" } }, tags: [{ id: "urn:tag:genre:place:restaurant:cafe", name: "Cafe" }, { id: "urn:tag:nearby_attraction:qloo:hotel", name: "Hotel" }, { id: "urn:tag:nearby_attraction:qloo:strip_club", name: "Strip club" }] };
    expect(venueEligibility(rowPlace(row)!, "coffee").allowed).toBe(true);
    const club = { ...row, name: "Fictional Club", properties: { primary_genre: { id: "urn:tag:genre:place:night_club" }, keywords: [{ name: "strip", count: 2 }] }, tags: [{ id: "urn:tag:genre:place:night_club", name: "Night club" }] };
    expect(venueEligibility(rowPlace(club)!, "dance").reasons).toContain("ambiguous_venue_type");
  });
  it("adult and hotel exclusions cannot be cancelled by high affinity or positive dance tags", () => {
    for (const p of [place("night_club", ["adult_entertainment"]), place("hotel", ["night_club"]), place("night_club", [], "Fictional Gentlemen's Club")]) expect(venueEligibility(p, "dance").allowed).toBe(false);
    expect(venueEligibility(place("performing_arts_theater", [], "Fictional Cabaret"), "culture").allowed).toBe(true);
  });
  it("no-bars checks all metadata even when the requested role is food or coffee", () => {
    const p = place("restaurant", ["pub"]);
    expect(venueEligibility(p, "food", [hard("exclude_type", "bars")]).reasons).toContain("excluded_type");
  });
  it("hard budgets, dietary and hours never treat unknown facts as satisfied", () => {
    const p = place("restaurant", ["coffee_shop"]);
    expect(venueEligibility(p, "food", [hard("budget", 2)])).toMatchObject({ allowed: true, priceStatus: "unknown", limitations: expect.arrayContaining(["Price level is unknown."]) });
    expect(venueEligibility({ ...p, priceLevel: 2 }, "food", [hard("budget", 2)]).allowed).toBe(true);
    expect(venueEligibility({ ...p, priceLevel: 4 }, "food", [hard("budget", "$$")]).allowed).toBe(false);
    expect(venueEligibility({ ...p, priceLevel: 4 }, "food", [hard("budget", "cheap")]).reasons).toContain("invalid_budget");
    expect(venueEligibility(p, "food", [hard("dietary", "vegetarian")]).reasons).toContain("dietary_unverified");
    expect(venueEligibility(p, "food", [hard("hours", "open")]).reasons).toContain("hours_unverified");
  });
  it("deduplicates an alternate ID at the same venue and one known chain", () => {
    const p = place("coffee_shop", [], "Starbucks");
    expect(dedupePlaces([p, { ...p, id: "other-id" }, { ...p, id: "branch", lon: .01 }], true)).toHaveLength(1);
    expect(dedupePlaces([place("coffee_shop", [], "Coffee"), { ...place("coffee_shop", [], "Coffee"), id: "independent", lon: .02 }], true)).toHaveLength(2);
  });
});

describe("provider parsing and resolution", () => {
  it("preserves documented ranks, explainability and warnings but drops unneeded metadata", () => {
    expect(trimResponse({ results: { entities: [{ entity_id: "test:id", query: { affinity_rank: .8, entity_artist_affinity_rank: .7, explainability: { "signal.interests.entities": [{ entity_id: "test:love", score: .6 }], warning: "Partial explanation" }, secret: "discard" }, references_brand: [{ entity_id: "test:brand", name: "Fictional" }] }] } })).toEqual({ results: { entities: [{ entity_id: "test:id", query: { affinity_rank: .8, entity_artist_affinity_rank: .7, explainability: { "signal.interests.entities": [{ entity_id: "test:love", score: .6 }], warning: "Partial explanation" } }, references_brand: [{ entity_id: "test:brand", name: "Fictional" }] }] } });
  });
  it("rejects gibberish namesakes without disabling normal prefixes and accented names", () => {
    expect(lexicalAgreement("zxqv-no-such-band-92841", "No1 Lounge at Luton Airport")).toBe(false);
    expect(lexicalAgreement("Bjork", "Björk")).toBe(true);
    expect(lexicalAgreement("Radio", "Radiohead")).toBe(true);
    expect(lexicalAgreement("Berghain", "Kantine am Berghain")).toBe(true);
    expect(entityResolution("unknown", [])).toBe("no_match");
  });
});
