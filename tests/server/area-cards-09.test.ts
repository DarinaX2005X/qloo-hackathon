import { describe, expect, it } from "vitest";
import { anchorOwner, areaCardCopy, assignAreaVenues, distinctiveStyle, leadingConnection, pickAnchors } from "@/server/engine/09/area-cards";
import { venueKey } from "@/server/engine/09/eligibility";
import { matchSignatures } from "@/server/engine/09/home-api";
import type { CityManifest } from "@/server/engine/09/manifest";
import type { AreaSignature, SignatureReference } from "@/server/engine/09/signatures";
import type { AreaIdentity, VenueEvidence } from "@/shared/contracts-09";
import { love, place, state } from "./helpers";

const area = (id: string, lon: number): AreaIdentity => ({ id, name: `Fictional ${id}`, aliases: [], center: [lon, 0], geometry: { kind: "circle", radiusM: 650 }, geometryQuality: "approximate" });
const areas = [area("west", 0), area("east", .006)];
function venue(id: string, lon: number, role: VenueEvidence["role"] = "coffee"): VenueEvidence {
  const primaryGenre = role === "coffee" ? "coffee_shop" : "museum";
  const p = { ...place(id, { lon }), primaryGenre, classifications: [primaryGenre], tags: [] };
  return { place: p, role, venueKey: venueKey(p), insideArea: true, eligibility: "eligible", priceStatus: "not_requested", hoursStatus: "unknown", connections: [], limitations: [], evidenceIds: ["test:catalog"] };
}
function linked(v: VenueEvidence, a: number, b: number): VenueEvidence {
  return { ...v, connections: [["a", a], ["b", b]].map(([id, score]) => ({ placeId: v.place.id, loveId: String(id), providerContribution: Number(score), sharedTagIds: [], explanationKind: "provider", evidenceIds: ["test:explain"] })) };
}
function styled(v: VenueEvidence, label: string): VenueEvidence {
  return { ...v, place: { ...v.place, tags: [{ id: `urn:tag:ambience:qloo:${label.toLowerCase()}`, name: label, kind: "ambience" }] } };
}

describe("exclusive area card evidence", () => {
  it("assigns shared venues to their nearest containing circle regardless of ranking order", () => {
    const overlap = venue("overlap", .004);
    expect(anchorOwner(overlap.place, areas)).toBe("east");
    expect(anchorOwner(overlap.place, [...areas].reverse())).toBe("east");
    const tied = venue("tie", .003);
    expect(anchorOwner(tied.place, areas)).toBe("east");
    expect(anchorOwner(venue("outside", 1).place, areas)).toBeNull();
    const pools = assignAreaVenues(areas, [overlap, overlap, venue("west", 0)]);
    expect(pools.get("east")?.map(v => v.place.id)).toEqual(["overlap"]);
    expect(pools.get("west")?.map(v => v.place.id)).toEqual(["west"]);
  });
  it("deduplicates aliases at one physical venue and retains explainability", () => {
    const original = venue("alias-1", .004);
    const alias = linked({ ...original, place: { ...original.place, id: "alias-2" } }, .6, .4);
    const pools = assignAreaVenues(areas, [original, alias, original]);
    expect([...pools.values()].flat()).toHaveLength(1);
    expect(pools.get("east")?.[0].connections).toHaveLength(2);
  });
  it("never borrows evidence to fill a sparse neighbor's card", () => {
    const pools = assignAreaVenues(areas, [venue("east-1", .005), venue("east-2", .006, "culture")]);
    expect(pickAnchors(pools.get("west")!)).toEqual([]);
    const copy = areaCardCopy({ area: areas[0], anchors: [], citySample: [], neutralByArea: pools });
    expect(copy.headline).toContain("No eligible places were verified");
  });
  it("deduplicates Home cards without altering signature overlap or the signature inputs", () => {
    const shared = styled(venue("shared", .004), "Historic").place;
    const own = styled(venue("west-only", 0), "Historic").place;
    const manifest: CityManifest = { cityId: "fictional-city", cityName: "Fictional", country: "Test", center: [0, 0], radiusM: 7500, version: "test:v1", fetchedAt: "2026-10-30T00:00:00Z", notes: [], rows: [], evidence: [], catalog: [shared, own],
      areas: areas.map(identity => ({ identity, cells: [], venueIds: [shared.id, own.id], neutralScore: .5 })) };
    const signatures: AreaSignature[] = manifest.areas.map(a => ({ area: a, manifest, places: a.identity.id === "west" ? [own, shared] : [shared], representatives: [], categoryCounts: { coffee: 2 }, style: [{ id: "historic", label: "Historic", tf: 1 }], music: [], quality: "sufficient", missingFamilies: [], evidence: [], musicStatus: "no_signal" }));
    const reference: SignatureReference = { version: "test:reference", cities: ["fictional-city"], styleIdf: new Map([["historic", 1]]), musicIdf: new Map(), citySignatures: new Map(), manifests: new Map(), evidence: [], complete: true };
    const before = JSON.stringify(signatures);
    const matches = matchSignatures(signatures[0], signatures, reference, "style_only_v1");
    expect(matches.map(m => m.similarity.value)).toEqual([100, 100]);
    expect(matches.find(m => m.area.area.id === "west")?.area.anchors.map(v => v.place.id)).toEqual(["west-only"]);
    expect(matches.find(m => m.area.area.id === "east")?.area.anchors.map(v => v.place.id)).toEqual(["shared"]);
    expect(JSON.stringify(signatures)).toBe(before);
  });
  it("aggregates provider contributions only across the area's shown anchors", () => {
    const anchors = [linked(venue("one", 0), .7, .3), linked(venue("two", 0), .4, .6), linked(venue("three", 0), .4, .6)];
    const profile = state({ loves: [love("a"), love("b")] });
    expect(leadingConnection(anchors, profile)).toMatchObject({ name: "a", total: 1.5, tied: true });
    anchors[2].connections[1].providerContribution = .7;
    expect(leadingConnection(anchors, profile)).toMatchObject({ name: "b", tied: false, venue: { place: { id: "three" } } });
    expect(leadingConnection(anchors, profile)?.total).toBeCloseTo(1.6);
    expect(leadingConnection([linked(venue("one", 0), .8, .2)], state({ loves: [love("unrelated")] }))).toBeNull();
    const invalid = linked(venue("bad", 0), .9, .8);
    invalid.connections[0].explanationKind = "local_weighted_rerank";
    invalid.connections[1].evidenceIds = [];
    expect(leadingConnection([invalid], profile)).toBeNull();
  });
  it("compares meaningful tags against a deduplicated city sample, without inventing affinity", () => {
    const anchors = [styled(venue("one", 0), "Historic"), styled(venue("two", 0), "Historic"), styled(venue("three", 0), "Casual")];
    const city = [anchors[0].place, venue("neutral-1", 0).place, venue("neutral-2", 0).place, venue("neutral-3", 0).place];
    expect(distinctiveStyle(anchors, [...city, city[0]])).toEqual({ label: "Historic", count: 2, cityCount: 1, cityTotal: 4 });
    const copy = areaCardCopy({ area: areas[0], anchors, citySample: city, neutralByArea: new Map() });
    expect(copy.headline).toContain("2 of 3 places are tagged “Historic”, compared with 1 of 4 in the city sample.");
    expect(copy.headline).not.toContain("Qloo links");
    expect(distinctiveStyle([styled(venue("generic", 0), "Casual")], city)).toBeNull();
  });
  it("reports catalog deficits as sample counts, and missing hours from metadata rather than visit status", () => {
    const culture = venue("museum", 0, "culture");
    const neutralByArea = new Map([["west", [culture]], ["east", [venue("cafe-1", .006), venue("cafe-2", .006)]]]);
    expect(areaCardCopy({ area: areas[0], anchors: [culture], citySample: [], neutralByArea }).tradeoff).toContain("checked catalog has 0 cafés assigned here; the area median is 1");
    expect(areaCardCopy({ area: areas[0], anchors: [culture, venue("discovered-cafe", 0)], citySample: [], neutralByArea }).tradeoff).not.toContain("0 cafés");
    const known = venue("known-hours", 0);
    known.place.hours = { monday: [{ opens: "09:00", closes: "18:00" }] };
    const missing = venue("missing-hours", 0);
    const copy = areaCardCopy({ area: areas[0], anchors: [known, missing], citySample: [], neutralByArea: new Map() });
    expect(copy.tradeoff).toBe("Hours are unlisted for missing-hours.");
  });
});
