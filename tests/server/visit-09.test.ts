import { describe, expect, it } from "vitest";
import { ExploreState } from "@/shared/contracts";
import { PlanRequestV2, type Constraint, type VenueEvidence } from "@/shared/contracts-09";
import { isOpenAt, venueEligibility } from "@/server/engine/09/eligibility";
import { auditVisit, scheduleVisit, visitDate, type VisitPool } from "@/server/engine/09/visit-api";
import { venueSignals } from "@/server/engine/09/venues-api";
import { love } from "./helpers";

const constraint = (kind: Constraint["kind"], value: string | number): Constraint => ({ id: `test:${kind}:${value}`, kind, value, strength: "hard", source: "user" });
const state = ExploreState.parse({ city: "Fictional City", loves: [love("fictional:music"), love("fictional:book", "book")], days: 1, startHour: 9 });
const area: VisitPool["area"] = { identity: { id: "fictional:area", name: "Fictional Area", aliases: [], center: [0, 0], geometry: { kind: "circle", radiusM: 650 }, geometryQuality: "approximate" }, cells: [], venueIds: [], neutralScore: .5 };
function venue(id: string, role: VenueEvidence["role"], extra: Partial<VenueEvidence["place"]> = {}): VenueEvidence {
  const genre = role === "culture" ? "book_store" : role === "coffee" ? "coffee_shop" : role === "food" ? "restaurant" : "night_club";
  return { place: { id, name: `Fictional ${id}`, lat: 0, lon: .001, category: role === "culture" ? "culture" : role === "coffee" ? "coffee" : role === "food" ? "food" : "drinks", popularity: .5, affinity: .8, why: [], mapsUrl: "https://example.invalid", primaryGenre: genre, classifications: [genre, "vegetarian"], priceLevel: 1, ...extra }, role, venueKey: id, eligibility: "eligible", insideArea: true, priceStatus: "known_within", hoursStatus: "unknown", connections: [], limitations: [], evidenceIds: ["fictional:evidence"] };
}
const input = (extra = {}) => PlanRequestV2.parse({ state, stateRevision: 1, areaIds: [area.identity.id], ...extra });
const date = new Date("2026-11-01T00:00:00Z");
describe("strict neighborhood visit", () => {
  it("rejects explicitly named hotel bars and a bar's secondary gallery tag", () => {
    const hostelBar = venue("hostel", "food", { name: "Fictional Hostel & Bar", primaryGenre: "restaurant:bar", classifications: ["bar", "restaurant"] }).place;
    expect(venueEligibility(hostelBar, "daily_life").reasons).toContain("hotel_venue");
    expect(venueEligibility(hostelBar, "daily_life", [], { geometryCatalog: true }).allowed).toBe(true);
    const galleryBar = venue("gallery-bar", "culture", { primaryGenre: "bar", classifications: ["bar", "art_gallery"] }).place;
    expect(venueEligibility(galleryBar, "culture").allowed).toBe(false);
    expect(venueEligibility(galleryBar, "bar").allowed).toBe(true);
  });
  it("allows unknown prices in nearby discovery but never in a hard-budget itinerary or audit", () => {
    const unknown = venue("unknown", "food", { priceLevel: undefined });
    const constraints = [constraint("budget", 2)];
    expect(venueEligibility(unknown.place, "food", constraints)).toMatchObject({ allowed: true, priceStatus: "unknown" });
    const result = scheduleVisit(input({ constraints }), [{ area, radiusM: 650, venues: [unknown] }], constraints, date);
    expect(result.itinerary.days[0].stops).toHaveLength(0);
    const tampered = scheduleVisit(input(), [{ area, radiusM: 650, venues: [unknown] }], [], date);
    tampered.constraints = constraints;
    expect(auditVisit(tampered, input({ constraints })).hardViolations.some(v => v.reason === "budget_unverified")).toBe(true);
  });
  it("deduplicates equal venue names without provider chain IDs and audits a tampered duplicate", () => {
    const one = venue("one", "coffee", { name: "Fictional Roasters" });
    const two = venue("two", "food", { name: "Fictional Roasters", lon: .002 });
    const other = venue("other", "food");
    const result = scheduleVisit(input(), [{ area, radiusM: 650, venues: [one, two, other] }], [], date);
    expect(result.itinerary.days[0].stops.map(s => s.place.id)).toEqual(["one", "other"]);
    result.venueEvidence.two = two;
    result.itinerary.days[0].stops[1].place = two.place;
    expect(auditVisit(result, input()).hardViolations.some(v => v.reason.includes("repeated"))).toBe(true);
  });
  it("never widens a chosen area's boundary to fill a visit gap", () => {
    const outside = { ...venue("outside", "food", { lon: .009 }), insideArea: false };
    const result = scheduleVisit(input(), [{ area, radiusM: 1200, venues: [venue("c", "coffee"), outside] }], [], date);
    expect(result.itinerary.days[0].stops.map(s => s.place.id)).toEqual(["c"]);
    expect(result.itinerary.days[0].missing).toContain("A local meal");
  });
  it("does not admit karaoke or a secondary nightclub tag as dance evidence", () => {
    const karaoke = venue("karaoke", "dance", { primaryGenre: "karaoke_bar", classifications: ["karaoke_bar", "night_club"] }).place;
    const pub = venue("pub", "dance", { primaryGenre: "pub", classifications: ["pub", "night_club"] }).place;
    expect(venueEligibility(karaoke, "dance").allowed).toBe(false);
    expect(venueEligibility(pub, "dance").allowed).toBe(false);
    expect(venueEligibility(venue("club", "dance").place, "dance").allowed).toBe(true);
    expect(venueEligibility(venue("club", "dance").place, "dance", [constraint("exclude_type", "adult clubs"), constraint("exclude_type", "hotel bars")]).allowed).toBe(true);
    expect(venueEligibility(venue("club", "dance").place, "dance", [constraint("exclude_type", "clubs")]).allowed).toBe(false);
  });
  it("enforces no bars even when the venue is classified as food with an onsite bar", () => {
    const place = venue("food-with-bar", "food", { tags: [{ id: "urn:tag:amenities:place:bar_onsite", name: "Bar onsite", kind: "amenities" }] }).place;
    expect(venueEligibility(place, "food", [constraint("exclude_type", "bars")]).reasons).toContain("excluded_type");
    expect(venueEligibility(place, "food", [constraint("exclude_type", "clubs")]).allowed).toBe(true);
  });
  it("does not infer music preferences from books or silently substitute artists", () => {
    expect(venueSignals(state, "dance").map(l => l.chosen.id)).toEqual(["fictional:music"]);
    expect(venueSignals({ ...state, loves: [love("book", "book")] }, "dance")).toEqual([]);
  });
  it("preserves all other IDs when replacing one stop, including later protected stops", () => {
    const coffee = venue("c", "coffee"), culture = venue("b", "culture"), food = venue("f", "food"), alternate = venue("c2", "coffee");
    const first = scheduleVisit(input(), [{ area, radiusM: 650, venues: [coffee, culture, food] }], [], date);
    expect(first.itinerary.days[0].stops.map(s => s.place.id)).toEqual(["c", "b", "f"]);
    const request = input({ existingItinerary: first.itinerary, replacePlaceId: "c", includeIds: ["b", "f"], excludeIds: ["c"] });
    const swapped = scheduleVisit(request, [{ area, radiusM: 650, venues: [coffee, culture, food, alternate] }], [], date, [culture, food]);
    expect(swapped.itinerary.days[0].stops.map(s => s.place.id)).toEqual(["c2", "b", "f"]);
    expect(auditVisit(swapped, request).hardViolations).toEqual([]);
  });
  it("cannot make a forbidden place pass by omitting constraints from the returned audit", () => {
    const constraints = [constraint("exclude_type", "bars")];
    const result = scheduleVisit(input(), [{ area, radiusM: 650, venues: [venue("coffee", "coffee"), venue("food", "food", { tags: [{ id: "urn:tag:amenity:qloo:bar", name: "Bar", kind: "amenity" }] })] }], [], date);
    const audit = auditVisit(result, input({ constraints }));
    expect(audit.hardViolations.some(v => v.reason.includes("missing"))).toBe(true);
    expect(audit.hardViolations.some(v => v.reason === "excluded_type")).toBe(true);
  });
  it("rechecks no bars, no museums, vegetarian and hard budget after radius recovery", () => {
    const constraints = [constraint("exclude_type", "bars"), constraint("exclude_type", "museums"), constraint("dietary", "vegetarian"), constraint("budget", 1)];
    const venues = [venue("adult", "dance", { classifications: ["night_club", "adult_entertainment"] }), venue("museum", "culture", { classifications: ["museum"] }), venue("unknown", "food", { priceLevel: undefined }), venue("meat", "food", { classifications: ["restaurant"] }), venue("bar", "food", { classifications: ["restaurant", "pub"] }), venue("c", "coffee"), venue("b", "culture"), venue("f", "food")];
    const request = input({ constraints });
    const result = scheduleVisit(request, [{ area, radiusM: 1200, venues }], constraints, date);
    expect(result.itinerary.days[0].stops.map(s => s.place.id)).toEqual(["c", "b", "f"]);
    expect(auditVisit(result, request).hardViolations).toEqual([]);
  });
  it("a swap cannot erase the previous visit's unfilled goals", () => {
    const first = scheduleVisit(input(), [{ area, radiusM: 650, venues: [venue("c", "coffee"), venue("f", "food")] }], [], date);
    expect(first.itinerary.days[0].missing).toContain("Explore the neighborhood");
    const swap = scheduleVisit(input({ existingItinerary: first.itinerary, replacePlaceId: "c", excludeIds: ["c"] }), [{ area, radiusM: 650, venues: [venue("c2", "coffee"), venue("f", "food")] }], [], date, [venue("f", "food")]);
    expect(swap.itinerary.days[0].missing).toContain("Explore the neighborhood");
    expect(swap.audit.unmet).not.toEqual([]);
  });
  it("carries previous-day overnight hours and rejects tomorrow's early closing for today", () => {
    const p = venue("night", "dance", { hours: { friday: [{ opens: "22:00", closes: "03:00" }], saturday: [{ opens: "22:00", closes: "04:00" }] } }).place;
    expect(isOpenAt(p, "saturday", 2 * 60)).toBe(true);
    expect(isOpenAt(p, "friday", 2 * 60)).toBe(false);
    expect(isOpenAt(p, "saturday", 12 * 60)).toBe(false);
  });
  it("known closing during a stop is a failed eligibility gate", () => {
    const p = venue("c", "coffee", { hours: { sunday: [{ opens: "09:00", closes: "09:20" }] } }).place;
    expect(venueEligibility(p, "coffee", [], { weekday: "sunday", minute: 9 * 60, stayMinutes: 45 }).reasons).toContain("closes_during_visit");
  });
  it("never repeats IDs or chains, and keeps real missing goals for empty days", () => {
    const chain = { ...venue("c", "coffee"), brandKey: "fictional:chain" };
    const copy = { ...venue("c2", "coffee"), brandKey: "fictional:chain" };
    const request = input({ state: { ...state, days: 3, pace: "packed" } });
    const result = scheduleVisit(request, [{ area, radiusM: 650, venues: [chain, chain, copy] }], [], date);
    const ids = result.itinerary.days.flatMap(d => d.stops.map(s => s.place.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.itinerary.days[2].stops).toEqual([]);
    expect(result.audit.unmet.some(u => u.goalId.startsWith("visit:day3"))).toBe(true);
  });
  it("keeps unknown hours visible and never labels event venues open from ordinary hours", () => {
    const constraints = [constraint("intent", "dance")];
    const result = scheduleVisit(input({ constraints }), [{ area, radiusM: 650, venues: [venue("c", "coffee"), venue("b", "culture"), venue("f", "food"), venue("d", "dance")] }], constraints, date);
    expect(result.venueEvidence.d.hoursStatus).toBe("event_required");
    expect(result.itinerary.days[0].stops.at(-1)?.hoursNote).toBe("hours not listed");
  });
  it("rejects impossible and past dates instead of normalizing them", () => {
    expect(() => visitDate("2026-02-30", new Date("2026-02-01"))).toThrow();
    expect(() => visitDate("2026-10-29", new Date("2026-10-30"))).toThrow();
  });
});
