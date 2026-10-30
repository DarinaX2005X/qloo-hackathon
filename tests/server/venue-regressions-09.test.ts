import { describe, expect, it } from "vitest";
import { venueEligibility } from "@/server/engine/09/eligibility";
import { BAR_CULTURE_REGRESSIONS, RAUSCHGOLD_REGRESSION } from "./fixtures/venue-regressions-09";

describe("reported venue type conflicts", () => {
  it.each(BAR_CULTURE_REGRESSIONS)("keeps $name out of culture despite secondary cultural tags", place => {
    expect(venueEligibility(place, "culture").allowed).toBe(false);
    expect(venueEligibility(place, "bar").allowed).toBe(true);
  });
  it("does not promote Rauschgold from primary bar to dancing through broad interest/amenity tags", () => {
    expect(venueEligibility(RAUSCHGOLD_REGRESSION, "dance").allowed).toBe(false);
    expect(venueEligibility(RAUSCHGOLD_REGRESSION, "bar").allowed).toBe(true);
  });
  it.each(["night_club", "electronic_music_venue"])("accepts a declared primary %s", primaryGenre => {
    const place = { ...RAUSCHGOLD_REGRESSION, name: "Fictional music venue", primaryGenre, classifications: [primaryGenre], tags: [] };
    expect(venueEligibility(place, "dance").allowed).toBe(true);
  });
  it("requires an own club genre when primary type is missing", () => {
    const place = { ...RAUSCHGOLD_REGRESSION, primaryGenre: undefined };
    expect(venueEligibility(place, "dance").allowed).toBe(true);
    expect(venueEligibility({ ...place, classifications: ["bar"], tags: place.tags!.filter(t => !t.id.includes(":genre:")) }, "dance").allowed).toBe(false);
  });
});
