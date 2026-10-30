import { describe, expect, it } from "vitest";
import {
  categoryRuleLabel,
  tagRuleLabel,
  crowdFromPopularity,
  crowdOf,
  CROWD_LABEL,
  gridText,
  legacyMetrics,
  metricExplainer,
  metricHeadline,
  metricNote,
  metricState,
  overlapText,
  percentileText,
  rankText,
  stopReasonLines,
  twinSharedTag,
  walkText,
  type MetricInput,
} from "@/lib/honest";
import { dayNoteLines, reasonText } from "@/lib/explain";

const m = (o: Partial<MetricInput> = {}): MetricInput => ({ rank: 1, candidateCount: 16, percentile: 97, tieBand: false, support: { quality: "sufficient" }, ...o });

describe("Area metric", () => {
  it("leads with the rank among the areas checked", () => {
    expect(rankText(m())).toBe("#1 of 16 areas checked");
    expect(rankText(m({ rank: 3 }), true)).toBe("#3 of 16");
    expect(rankText({ rank: 2, candidateCount: 0 })).toBe("#2");
  });
  it("shows a percentile only with enough support and at least five areas, never as Match", () => {
    expect(percentileText(m({ percentile: 85 }))).toBe("Top 15% of checked areas");
    expect(percentileText(m({ percentile: 85 }), true)).toBe("Ahead of about 85% of the areas checked for your taste");
    expect(percentileText(m({ candidateCount: 4 }))).toBeNull();
    expect(percentileText(m({ support: { quality: "limited" } }))).toBeNull();
    expect(percentileText(m({ percentile: null }))).toBeNull();
    expect(percentileText(m({ percentile: 30 }))).toBeNull();
    for (const p of [0, 46, 85, 99]) expect(percentileText(m({ percentile: p })) ?? "").not.toMatch(/match|alike|probab/i);
  });
  it("puts limited data before a close call before a plain rank", () => {
    expect(metricState(m({ tieBand: true, support: { quality: "limited" } }))).toBe("limited");
    expect(metricNote(m({ tieBand: true, support: { quality: "limited" } }))).toBe("Limited data");
    expect(metricNote(m({ tieBand: true }))).toBe("About level with the next area");
    expect(metricNote(m({ rank: 2, tieBand: true }))).toBe("About level with its neighbors in the list");
    expect(metricNote(m({ percentile: 90 }))).toBe("Top 10% of checked areas");
  });
  it("names the shortlist by its real state", () => {
    expect(metricHeadline([m(), m({ rank: 2 })])).toBe("Start with these areas");
    expect(metricHeadline([m({ tieBand: true }), m({ rank: 2, tieBand: true })])).toBe("Several close options");
    expect(metricHeadline([m({ support: { quality: "limited" } })])).toBe("Limited data for this taste");
    expect(metricHeadline([])).toBe("No areas checked yet");
  });
  it("adapts a legacy neighborhood to its rank only", () => {
    const legacy = legacyMetrics({ rank: 2 }, [1, 2, 3]);
    expect(rankText(legacy)).toBe("#2 of 3 areas checked");
    expect(metricNote(legacy)).toBeNull();
  });
  it("defines the number with its denominator and without a probability claim", () => {
    const t = metricExplainer({ city: "Lisbon", candidateCount: 16 });
    expect(t).toContain("16 areas in Lisbon");
    expect(t).toMatch(/not a probability/);
  });
});

describe("Home overlap", () => {
  it("is an index out of 100 with its method, and hidden when support is limited", () => {
    expect(overlapText({ value: 41.6, method: "style_music_v1", support: "sufficient" })).toBe("Cultural-profile overlap 42/100");
    expect(overlapText({ value: 41.6, method: "style_only_v1", support: "sufficient" })).toBe("Style overlap 42/100");
    expect(overlapText({ value: 41.6, method: "style_music_v1", support: "limited" })).toBeNull();
    expect(overlapText({ value: null })).toBeNull();
    expect(overlapText({ value: 88 }) ?? "").not.toMatch(/%|alike/);
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
