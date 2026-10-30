import { describe, expect, it } from "vitest";
import type { DecidesResult, Itinerary } from "@/shared/contracts";
import { dayNoteLines, decidesStatement } from "@/lib/explain";

const decides = (without: [string, number | null][]): DecidesResult => ({
  neighborhoods: [{ id: "sc", name: "Santa Catarina", rank: 1, without: without.map(([name, rank]) => ({ query: name, name, rank })) }],
  pivotal: without.find(([, rank]) => rank !== 1)?.[0] ?? null,
  robust: without.every(([, rank]) => rank === 1),
  summary: "",
});

describe("What decides line", () => {
  it("never says a single love decides the top spot when several move it", () => {
    const st = decidesStatement(decides([["Radiohead", 1], ["Wes Anderson", null], ["Patagonia", null]]))!;
    expect(st.text).not.toMatch(/decides/i);
    expect(st.text).toContain("without Wes Anderson and also without Patagonia, each taken away on its own");
  });

  it("names the one love when only one moves the top, still without 'decides'", () => {
    const st = decidesStatement(decides([["Radiohead", 1], ["Fleabag", 4]]))!;
    expect(st.text).toBe("Without Fleabag, Santa Catarina is no longer first; take away any other love on its own and it stays on top.");
  });

  it("says the pick holds when no single love moves it", () => {
    expect(decidesStatement(decides([["Radiohead", 1], ["Fleabag", 1]]))!.robust).toBe(true);
  });
});

type Day = Itinerary["days"][number];
const day = (over: Partial<Day>): Day => ({ neighborhood: "Outremont", stops: [], missing: [], ...over });

describe("Trip day note", () => {
  it("collapses an empty day into one line and does not claim places are closed", () => {
    const lines = dayNoteLines(day({ missing: ["Morning coffee", "Lunch", "Afternoon", "Dinner", "Evening drinks", "Late"] }), "Montreal");
    expect(lines).toEqual(["Homing couldn't fill this day in Outremont with places that fit you; try Plan again or a wider area."]);
    expect(lines.join(" ")).not.toMatch(/closed|open/i);
  });

  it("shows the backend's note instead when there is one", () => {
    expect(dayNoteLines(day({ missing: ["Lunch"], note: "Widened the search around Outremont to 2.2 km." }), "Montreal"))
      .toEqual(["Widened the search around Outremont to 2.2 km."]);
  });

  it("names reasons only when the backend sends them, grouped per reason", () => {
    const stop = { time: "09:00", slot: "Morning coffee", walkMin: 0, place: { id: "p", name: "Café", category: "coffee" as const, lat: 0, lon: 0, affinity: 1, popularity: 0.5, why: [], mapsUrl: "" } };
    const lines = dayNoteLines(day({ stops: [stop], missing: ["Lunch", "Dinner", "Late"], issues: [{ slot: "Lunch", reason: "closed" }, { slot: "Dinner", reason: "closed" }, { slot: "Late", reason: "over_budget" }] }), "Montreal");
    expect(lines).toEqual(["Lunch and dinner: the places that fit you are closed then.", "Late: the places that fit you are over your budget."]);
  });

  it("gives an empty day its known reasons in the one line", () => {
    const lines = dayNoteLines(day({ missing: ["Lunch", "Dinner"], issues: [{ slot: "Lunch", reason: "none_nearby" }, { slot: "Dinner", reason: "none_nearby" }] }), "Montreal");
    expect(lines).toEqual(["Homing couldn't fill this day in Outremont with places that fit you (no place that fits you nearby); try Plan again or a wider area."]);
  });
});
