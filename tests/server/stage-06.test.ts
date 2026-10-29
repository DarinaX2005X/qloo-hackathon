import { afterEach, describe, expect, it, vi } from "vitest";
import { CityScore, activeLoves, type Category } from "@/shared/contracts";
import { planFromPlaces, planSlots } from "@/server/engine/plan";
import { bestCategory, placeFromRow, withinBudget, comparePlaces } from "@/server/engine/places";
import { cityPlaceCoverage, cityScoreFromRows } from "@/server/engine/cities";
import { clearQlooCache } from "@/server/qloo/client";
import { clearEvidenceCache } from "@/server/engine/evidence";
import { buildField } from "@/server/engine/field";
import { rankNeighborhoods } from "@/server/engine/neighborhoods";
import { buildFingerprint } from "@/server/engine/fingerprint";
import { place, state, venue } from "./helpers";

const now = new Date("2026-11-01T12:00:00Z");
const profile = [{ id: "urn:tag:ambience:qloo:cozy", name: "Cozy", kind: "ambience" }, { id: "urn:tag:decor:qloo:vintage", name: "Vintage", kind: "decor" }];

export function planPool(): ReturnType<typeof place>[] {
  return (["coffee", "culture", "food", "drinks"] as Category[]).flatMap((category) => Array.from({ length: 10 }, (_, i) =>
    place(`${category}-${i}`, { category, affinity: 1 - i * 0.02, lon: i * 0.0001, priceLevel: 2 })));
}

describe("06 places and plan", () => {
  it("keeps budget-compatible places and ranks unknown prices below equal matches", () => {
    const known = place("known", { priceLevel: 2 });
    const unknown = place("unknown");
    expect(withinBudget(place("costly", { priceLevel: 4 }), 2)).toBe(false);
    expect(withinBudget(unknown, 1)).toBe(true);
    expect([unknown, known].sort(comparePlaces).map((item) => item.id)).toEqual(["known", "unknown"]);
    const plan = planFromPlaces(1, [{ id: "a", name: "A", places: [place("costly", { affinity: 1, priceLevel: 4 }), unknown, known] }], now, { budget: 2 });
    expect(plan.days[0].stops[0].place.id).toBe("known");
    expect(plan.days[0].stops.every((stop) => stop.place.id !== "costly")).toBe(true);
  });

  it("projects website, bounded description and five clean keywords; primary genre decides category", () => {
    const row = { ...venue("cafe", "A"), properties: { website: "https://cafe.example", description: "x".repeat(200),
      primary_genre: { id: "urn:tag:genre:place:restaurant:coffee_shop" },
      keywords: [{ name: "parking", count: 100 }, ...Array.from({ length: 7 }, (_, i) => ({ name: `taste-${i}`, count: 20 - i }))] },
      tags: [{ id: "urn:tag:category:place:restaurant", name: "Restaurant" }, { id: "urn:tag:genre:place:restaurant:coffee_shop", name: "Coffee shop" }] };
    expect(bestCategory(row)).toBe("coffee");
    const converted = placeFromRow(row, "coffee", []);
    expect(converted?.website).toBe("https://cafe.example/");
    expect(converted?.description).toHaveLength(160);
    expect(converted?.keywords).toEqual(["taste-0", "taste-1", "taste-2", "taste-3", "taste-4"]);
    expect(bestCategory({ ...row, properties: { primary_genre: { id: "urn:tag:genre:place:book_store" } } })).toBe("culture");
  });

  it.each([["relaxed", 4], ["balanced", 6], ["packed", 8]] as const)("schedules %s with %s slots and start hour 11", (pace, count) => {
    const slots = planSlots(pace, 11);
    expect(slots).toHaveLength(count);
    expect(slots[0].time).toBe("11:00");
    // drinks two hours after dinner, never past 23:30
    const dinner = slots.find((slot) => slot.slot === "Dinner")!.time;
    expect(Number(slots.at(-1)!.time.slice(0, 2)) - Number(dinner.slice(0, 2))).toBe(2);
    expect(new Set(slots.map((slot) => slot.slot)).size).toBe(slots.length);
    const plan = planFromPlaces(1, [{ id: "a", name: "A", places: planPool() }], now, { pace, startHour: 11 });
    expect(plan.days[0].stops).toHaveLength(count);
    expect(new Set(plan.days[0].stops.map((stop) => stop.place.id)).size).toBe(count);
    expect(planSlots(pace, 6).find((slot) => slot.slot === "Dinner")?.time).toBe("19:00");
  });

  it("reserves includes at the earliest fitting slot, handles conflicts, closure and unknown ids", () => {
    const pool = planPool();
    pool.push(place("closed", { category: "culture", hours: { monday: [], tuesday: [] } }));
    const options = { include: ["culture-9", "food-9", "closed", "absent"] };
    const plan = planFromPlaces(2, [{ id: "a", name: "A", places: pool }], now, options);
    expect(plan.days[0].stops.find((stop) => stop.slot === "Morning culture")?.place.id).toBe("culture-9");
    expect(plan.days[0].stops.find((stop) => stop.slot === "Lunch")?.place.id).toBe("food-9");
    expect(plan.days[1].missing).toContain("Couldn't fit closed: closed at the available times");
    expect(plan.days[1].missing).toContain("Couldn't fit absent: not available in the selected neighborhoods");
    const replacement = planFromPlaces(2, [{ id: "a", name: "A", places: pool }], now, { ...options, exclude: ["culture-9"] });
    expect(replacement.days.flatMap((day) => day.stops).some((stop) => stop.place.id === "culture-9")).toBe(false);
    for (let d = 0; d < plan.days.length; d++) for (const stop of plan.days[d].stops) if (stop.place.id !== "culture-9")
      expect(replacement.days[d].stops.find((item) => item.slot === stop.slot)?.place.id).toBe(stop.place.id);
  });

  it("replaces only the excluded slot and preserves the other stops across all days deterministically", () => {
    const areas = [{ id: "a", name: "A", places: planPool() }];
    const original = planFromPlaces(2, areas, now, { pace: "packed", startHour: 11 });
    const removed = original.days[0].stops[0].place.id;
    const next = planFromPlaces(2, areas, now, { pace: "packed", startHour: 11, exclude: [removed] });
    expect(next).toEqual(planFromPlaces(2, [{ ...areas[0], places: [...areas[0].places].reverse() }], now, { pace: "packed", startHour: 11, exclude: [removed] }));
    for (let day = 0; day < 2; day++) for (const stop of original.days[day].stops) if (stop.place.id !== removed)
      expect(next.days[day].stops.find((item) => item.slot === stop.slot)?.place.id).toBe(stop.place.id);
    expect(next.days.flatMap((day) => day.stops).some((stop) => stop.place.id === removed)).toBe(false);
  });
});

describe("06 comparable city evidence", () => {
  it("uses the same semantic denominator across cities even when Qloo affinity is identical", () => {
    const strong = { ...venue("strong", "District"), tags: profile, query: { affinity: 0.99 } };
    const weak = { ...venue("weak", "Elsewhere"), tags: [], query: { affinity: 0.99 } };
    expect(cityPlaceCoverage(strong, profile)).toBe(1);
    expect(cityPlaceCoverage(weak, profile)).toBe(0);
    const cityA = cityScoreFromRows("A", [strong, weak], [0, 0], profile);
    const cityB = cityScoreFromRows("B", [weak], [0, 0], profile);
    expect(CityScore.parse(cityA).score).toBe(0.5);
    expect(cityA.depth).toBe(0.5);
    expect(cityB.score).toBe(0);
    expect(cityScoreFromRows("Missing", [], [0, 0], profile)).toMatchObject({ score: 0, error: "We couldn't find enough places in Missing" });
    expect(cityScoreFromRows("District", [strong], [0, 0], profile).topNeighborhood).toBeNull();
  });
});

describe("06 shared pipeline cache", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearQlooCache(); clearEvidenceCache(); });
  it("does not make new network calls for neighborhoods/fingerprint after a warmed field", async () => {
    vi.stubEnv("QLOO_API_KEY", "synthetic");
    clearQlooCache(); clearEvidenceCache();
    const fetcher = vi.fn().mockImplementation(async (input: URL) => {
      const type = input.searchParams.get("filter.type");
      if (type === "urn:heatmap") return Response.json({ results: { heatmap: [{ location: { geohash: "aaaaaa", latitude: 0, longitude: 0 }, query: { affinity: 0.8, entity_artist_affinity: 0.8 } }] } });
      if (type === "urn:tag") return Response.json({ results: { tags: [] } });
      return Response.json({ results: { entities: [venue("a", "District", 0), venue("b", "District", 0.001), venue("c", "District", -0.001)] } });
    });
    vi.stubGlobal("fetch", fetcher);
    const input = state();
    expect(activeLoves(input.loves)).toHaveLength(1);
    await buildField(input);
    const calls = fetcher.mock.calls.length;
    expect(await rankNeighborhoods(input)).toHaveLength(1);
    await buildFingerprint(input);
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
});
