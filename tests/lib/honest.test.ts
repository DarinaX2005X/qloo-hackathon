import { describe, expect, it } from "vitest";
import { categoryRuleLabel, tagRuleLabel, crowdFromPopularity, crowdOf, CROWD_LABEL, gridText, matchIndex, matchPhrase, stopReasonLines, twinSharedTag, walkText } from "@/lib/honest";
import { dayNoteLines, reasonText } from "@/lib/explain";

describe("Match index", () => {
  it("is the ordering score on a 0-100 scale, below 50 shown as it is", () => {
    expect(matchPhrase(0.5365)).toBe("Match 54");
    expect(matchPhrase(0.459)).toBe("Match 46");
    expect(matchIndex(0)).toBe(0);
    expect(matchIndex(undefined)).toBeNull();
  });
});

describe("Crowd", () => {
  it("uses the backend crowd and falls back from the legacy vibe without residents or visitors", () => {
    expect(CROWD_LABEL[crowdOf({ crowd: "busy", vibe: "local" })]).toBe("Busy");
    expect(CROWD_LABEL[crowdOf({ vibe: "local" })]).toBe("Quieter");
    expect(CROWD_LABEL[crowdOf({ vibe: "mixed" })]).toBe("Moderate");
    expect(CROWD_LABEL[crowdOf({ vibe: "touristy" })]).toBe("Busy");
    expect(Object.values(CROWD_LABEL).join(" ")).not.toMatch(/local|tourist|visitor/i);
  });
  it("uses the backend thresholds for a map cell", () => {
    expect(crowdFromPopularity(0.9)).toBe("busy");
    expect(crowdFromPopularity(0.7)).toBe("moderate");
    expect(crowdFromPopularity(0.6)).toBe("quiet");
  });
});

describe("Address and walking", () => {
  it("says the estimate is neighborhood-level and walking is approximate", () => {
    expect(gridText(1200)).toBe("Neighborhood estimate · roughly 1 km grid");
    expect(gridText(600)).toBe("Neighborhood estimate · roughly 0.6 km grid");
    expect(walkText(8)).toBe("≈ 8 min walk");
    expect(walkText(0.2)).toBe("≈ 1 min walk");
  });
});

describe("Feels like home twins", () => {
  it("names the most telling shared tag, and none when nothing is shared", () => {
    expect(twinSharedTag({ tags: ["Casual", "Artistic", "Chic"] }, { tags: ["Artistic", "Casual"] })).toBe("Artistic");
    expect(twinSharedTag({ tags: ["Casual"] }, { tags: ["casual"] })).toBe("Casual");
    expect(twinSharedTag({ tags: ["Historic"] }, { tags: ["Modern"] })).toBeNull();
  });
});

describe("Plan reasons", () => {
  it("describes adapted stops in plain words and leaves slot reasons to the day", () => {
    expect(stopReasonLines(["none_nearby", "relaxed_neighborhood", "relaxed_neighborhood", "closed"])).toEqual([
      "From another ranked area nearby",
      "Replaced a pick that is closed at this time",
    ]);
    expect(stopReasonLines(undefined)).toEqual([]);
  });
  it("words every backend reason code, and unsuitable_time is not a closure", () => {
    for (const code of ["none_nearby", "closed", "over_budget", "unsuitable_time", "relaxed_neighborhood", "relaxed_radius", "relaxed_preferences", "relaxed_category"])
      expect(reasonText(code)).toBeTruthy();
    expect(reasonText("unsuitable_time")).not.toMatch(/closed|open/i);
  });
  it("names unsuitable_time on a day with stops", () => {
    const stop = { time: "10:12", slot: "Morning coffee", walkMin: 0, place: { id: "p", name: "Café", category: "coffee" as const, lat: 0, lon: 0, affinity: 1, popularity: 0.5, why: [], mapsUrl: "" } };
    expect(dayNoteLines({ neighborhood: "Pena", stops: [stop], missing: ["Afternoon"], issues: [{ slot: "Afternoon", reason: "unsuitable_time" }] }, "Lisbon")).toEqual([
      "Afternoon: the places that fit you don't suit that time of day.",
    ]);
  });
});

describe("Plan rule chips", () => {
  it("reads exclusions as plain chips", () => {
    expect(tagRuleLabel("museum")).toBe("No museums");
    expect(tagRuleLabel("urn:tag:category:qloo:art_gallery")).toBe("No art galleries");
    expect(tagRuleLabel("nightclubs")).toBe("No nightclubs");
    expect(categoryRuleLabel("stay")).toBe("No hotels");
  });
});
