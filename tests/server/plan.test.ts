import { describe, expect, it } from "vitest";
import { isOpen, planFromPlaces } from "@/server/engine/plan";
import { walkMinutes } from "@/server/engine/geo";
import { place } from "./helpers";

describe("opening hours", () => {
  const monday = new Date("2026-11-02T00:00:00Z");
  it("handles explicit closure, absent hours and closing boundaries", () => {
    expect(isOpen(place("closed", { hours: { monday: [] } }), monday, "09:00")).toBe(false);
    expect(isOpen(place("unknown"), monday, "09:00")).toBeUndefined();
    const cafe = place("cafe", { hours: { monday: [{ opens: "09:00", closes: "10:00" }] } });
    expect(isOpen(cafe, monday, "09:00")).toBe(true);
    expect(isOpen(cafe, monday, "10:00")).toBe(false);
  });

  it("uses the previous weekday for overnight service, not tonight's interval", () => {
    const bar = place("bar", { hours: { sunday: [{ opens: "20:00", closes: "02:00" }], monday: [{ opens: "22:00", closes: "03:00" }] } });
    expect(isOpen(bar, monday, "01:00")).toBe(true);
    expect(isOpen(bar, monday, "02:30")).toBe(false);
    expect(isOpen(bar, monday, "21:30")).toBe(false);
    expect(isOpen(bar, monday, "23:00")).toBe(true);
    expect(isOpen(bar, new Date("2026-11-03T00:00:00Z"), "02:30")).toBe(true);
  });
});

describe("itinerary solver", () => {
  const now = new Date("2026-11-01T23:00:00Z");
  it("skips closed or unavailable slots, marks unknown hours and never repeats an id", () => {
    const pool = [
      place("closed", { affinity: 1, hours: { monday: [], tuesday: [] } }),
      place("cafe"), place("museum", { category: "culture", hours: { monday: [{ opens: "10:00", closes: "15:00" }], tuesday: [] } }),
      place("meal", { category: "food" }), place("bar", { category: "drinks", hours: { monday: [{ opens: "22:00", closes: "02:00" }], tuesday: [] } }),
      place("meal", { category: "coffee" }),
    ];
    const plan = planFromPlaces(2, [{ id: "first", name: "First", places: pool }], now);
    const stops = plan.days.flatMap((day) => day.stops);
    expect(stops.map((stop) => stop.place.id)).toEqual(["cafe", "museum", "meal"]);
    expect(plan.days[0].date).toBe("2026-11-02");
    expect(plan.days[0].weekday).toBe("monday");
    expect(stops[0].hoursNote).toBe("hours not listed");
    expect(stops[1].hoursNote).toBe("open");
    expect(plan.days[0].missing).toContain("Evening drinks");
    expect(plan.days[1].stops).toEqual([]);
    expect(new Set(stops.map((stop) => stop.place.id)).size).toBe(stops.length);
  });

  it("trades affinity against walking and uses each next neighborhood on following days", () => {
    const first = [place("start", { affinity: 1 }), place("near", { category: "culture", affinity: 0.7, lon: 0.001 }), place("far", { category: "culture", affinity: 1, lon: 0.02 })];
    const plan = planFromPlaces(3, [
      { id: "a", name: "A", places: first },
      { id: "b", name: "B", places: [place("second")] },
      { id: "c", name: "C", places: [place("third")] },
    ], now);
    expect(plan.days.map((day) => day.neighborhood)).toEqual(["A", "B", "C"]);
    expect(plan.days[0].stops[1].place.id).toBe("near");
    expect(plan.days[0].stops[1].walkMin).toBe(Math.round(walkMinutes([0, 0], [0.001, 0])));
  });
});
