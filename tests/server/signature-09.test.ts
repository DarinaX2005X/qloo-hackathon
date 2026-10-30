import { describe, expect, it } from "vitest";
import { buildIdf, selectSignaturePlaces, signatureRepresentatives, signatureSimilarity, signatureSupport, styleTermFrequency, substantiveStyleTag, weightedJaccard, weightedVector, type SignatureReference } from "@/server/engine/09/signatures";
import type { PlaceV2 } from "@/shared/contracts-09";

const reference: SignatureReference = { version: "test:fixed-reference", cities: ["A", "B", "C"], styleIdf: new Map([["style:a", 2], ["style:b", 1.5]]), musicIdf: new Map([["music:a", 1.8], ["music:b", 1.2]]), citySignatures: new Map(), manifests: new Map(), evidence: [], complete: true };
const source = { quality: "sufficient" as const, style: [{ id: "style:a", label: "A", tf: .7 }, { id: "style:b", label: "B", tf: .3 }], music: [{ id: "music:a", label: "A", tf: .8 }, { id: "music:b", label: "B", tf: .2 }] };
function venue(id: string, primary: string, tag = "Historic"): PlaceV2 {
  return { id, name: `Fictional ${id}`, category: "food", lat: 0, lon: 0, affinity: .5, popularity: .5, why: [], mapsUrl: "https://example.invalid", primaryGenre: primary, classifications: [primary], tags: [{ id: `urn:tag:ambience:qloo:${tag.toLowerCase()}`, name: tag, kind: "ambience" }] };
}
describe("canonical home signatures", () => {
  it("identity is exactly 100 without a special source-equals-target branch", () => {
    expect(signatureSimilarity(source, structuredClone(source), reference, "style_music_v1")).toBeCloseTo(100, 12);
    expect(signatureSimilarity(source, structuredClone(source), reference, "style_only_v1")).toBeCloseTo(100, 12);
  });
  it("missing features and unsupported target coverage never become an inflated identity", () => {
    expect(weightedJaccard(new Map(), new Map())).toBeNull();
    expect(signatureSimilarity(source, { ...source, quality: "limited" }, reference, "style_music_v1")).toBeNull();
    expect(signatureSimilarity(source, { ...source, music: [] }, reference, "style_music_v1")).toBeNull();
    expect(signatureSimilarity(source, { ...source, music: [] }, reference, "style_only_v1")).toBeCloseTo(100, 12);
  });
  it("equal city weighting survives a tenfold duplication of a city's entire documents", () => {
    const cities = [{ documents: [["rare"], ["other"]] }, { documents: [["other"], ["unseen"]] }];
    const first = buildIdf(cities), second = buildIdf([{ documents: Array.from({ length: 10 }, () => cities[0].documents).flat() }, cities[1]]);
    for (const [id, weight] of first) expect(second.get(id)).toBeCloseTo(weight, 12);
  });
  it("common features are removed and document duplicates cannot increase frequency", () => {
    const idf = buildIdf([{ documents: [["common", "common", "rare"], ["common"]] }, { documents: [["common"], ["common"]] }, { documents: [["common"], ["common"]] }]);
    expect(idf.get("common")).toBe(0); expect(idf.get("rare")).toBeGreaterThan(1);
    expect([...weightedVector([{ id: "common", label: "C", tf: 1 }], idf, 3)]).toEqual([]);
  });
  it("comparison with a third target does not refit the frozen reference", () => {
    const initial = signatureSimilarity(source, source, reference, "style_music_v1");
    signatureSimilarity(source, { ...source, style: [{ id: "novel", label: "N", tf: 1 }] }, reference, "style_music_v1");
    expect(signatureSimilarity(source, source, reference, "style_music_v1")).toBe(initial);
    expect(reference.styleIdf.has("novel")).toBe(false);
  });
  it("styles use semantic tags, not generic categories, countries or wifi", () => {
    expect(substantiveStyleTag({ id: "urn:tag:ambience:qloo:historic", name: "Historic" })).toBe(true);
    for (const name of ["Welcoming", "Relaxing", "Cozy", "Large group", "Family friendly"]) expect(substantiveStyleTag({ id: `urn:tag:ambience:place:${name.toLowerCase().replace(/ /g, "_")}`, name })).toBe(false);
    for (const [id, name] of [["urn:tag:ambience:qloo:casual", "Casual"], ["urn:tag:genre:place:restaurant", "Restaurant"], ["urn:tag:amenity:wifi", "Wifi"], ["urn:tag:cuisine:portuguese", "Portuguese"]]) expect(substantiveStyleTag({ id, name })).toBe(false);
  });
  it("caps every family at six places and representatives at eight", () => {
    const pool = ["coffee_shop", "restaurant", "night_club", "museum"].flatMap((primary, group) => Array.from({ length: 10 }, (_, i) => venue(`${group}-${i}`, primary)));
    const selected = selectSignaturePlaces(pool);
    expect(selected).toHaveLength(24);
    expect(signatureRepresentatives(selected)).toHaveLength(8);
    expect(signatureSupport(selected).quality).toBe("sufficient");
    expect(signatureSupport(pool.filter(p => p.primaryGenre === "restaurant")).quality).toBe("limited");
  });
  it("category-balanced style frequency is unaffected by duplicating a category's venues", () => {
    const one = [venue("c", "coffee_shop", "Intimate"), venue("f", "restaurant", "Historic"), venue("m", "museum", "Historic")];
    const multiple = [...one, ...Array.from({ length: 5 }, (_, i) => venue(`extra${i}`, "coffee_shop", "Intimate"))];
    const a = styleTermFrequency(one), b = styleTermFrequency(multiple);
    expect(b.map(f => f.id)).toEqual(a.map(f => f.id));
    a.forEach((feature, i) => expect(b[i].tf).toBeCloseTo(feature.tf, 12));
  });
});
