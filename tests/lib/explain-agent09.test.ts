import { describe, expect, it } from "vitest";
import { deriveTurn, isStaleResult, liveSteps, orderResults, turnOutcome } from "@/components/agent09/turn";
import type { AgentEventV2, Constraint, GoalState, ResultMeta } from "@/components/agent09/types";
import { constraintLabel, unmetText, venueStatusLines } from "@/lib/explain";

// Fictional events for the reader; no names or numbers here come from a live run.
const T = "turn-1";
const meta = (analysisId: string, stateRevision = 3): ResultMeta => ({
  responseVersion: 2,
  analysisId,
  profileHash: "p",
  stateRevision,
  cityId: "lisbon",
  manifestVersion: "m1",
  methodVersion: "h1",
  generatedAt: "2026-10-30T15:00:00Z",
  dataAsOf: "2026-10-30T15:00:00Z",
  cache: "fresh",
  status: "complete",
});
const goal = (id: string, kind: GoalState["kind"], status: GoalState["status"] = "pending"): GoalState => ({ id, kind, status, resultIds: [], unmet: [] });
const memory = { revision: 3, constraints: [], selectedAreaIds: [], rejectedPlaceIds: [], savedPlaceIds: [], lastResults: [] };

describe("deriveTurn", () => {
  it("keeps the order of what happened and updates a step in place", () => {
    const ev: AgentEventV2[] = [
      { type: "ack", turnId: T, text: "I'll check the address first." },
      { type: "plan", turnId: T, goals: [goal("g1", "evaluate_address"), goal("g2", "build_visit")], steps: ["Check the address", "Plan a walk"] },
      { type: "step", turnId: T, stepId: "s1", status: "running", text: "Finding the street" },
      { type: "step", turnId: T, stepId: "s1", status: "done", text: "Found the street" },
      { type: "observation", turnId: T, goalId: "g2", text: "No café passed the rules", evidenceIds: [] },
      { type: "replan", turnId: T, reason: "The walk had no café", nextAction: "Looking a little further out" },
      { type: "step", turnId: T, stepId: "s2", status: "running", text: "Looking further out" },
    ];
    const t = deriveTurn(ev);
    expect(t.ack).toBe("I'll check the address first.");
    expect(t.steps).toEqual([
      { id: "s1", status: "done", text: "Found the street" },
      { id: "s2", status: "running", text: "Looking further out" },
    ]);
    expect(t.timeline.map((e) => e.kind)).toEqual(["step", "observation", "replan", "step"]);
    expect(t.replans).toHaveLength(1);
    expect(t.done).toBe(false);
    expect(turnOutcome(t)).toBe("working");
    // a running step lights the first pending goal while the backend has not named one
    expect(t.goals[0].status).toBe("running");
  });

  it("takes the final ledger from done and never drops a planned goal", () => {
    const ev: AgentEventV2[] = [
      { type: "plan", turnId: T, goals: [goal("g1", "evaluate_address"), goal("g2", "build_visit")], steps: [] },
      { type: "done", turnId: T, goals: [{ ...goal("g1", "evaluate_address", "satisfied") }], memory },
    ];
    const t = deriveTurn(ev);
    expect(t.goals.map((g) => g.status)).toEqual(["satisfied"]);
    expect(t.unreported).toHaveLength(1);
    expect(t.unreported[0]).toMatchObject({ id: "g2", status: "failed", unmet: ["not_reported"] });
    expect(turnOutcome(t)).toBe("partial");
    expect(t.memory).toEqual(memory);
  });

  it("marks the goal of an error as not finished until done says otherwise", () => {
    const t = deriveTurn([
      { type: "plan", turnId: T, goals: [goal("g1", "find_venues", "running")], steps: [] },
      { type: "error", turnId: T, goalId: "g1", retryable: true, message: "Qloo did not answer in time" },
    ]);
    expect(t.goals[0].status).toBe("failed");
    expect(t.errors[0].retryable).toBe(true);
  });

  it("replaces a result of the same kind and analysis, keeps different ones", () => {
    const visit = (n: number) => ({
      kind: "visit" as const,
      result: { itinerary: { days: [] }, constraints: [], venueEvidence: {}, audit: { hardViolations: [], unmet: [], warnings: [String(n)] }, recoveryLog: [], evidenceIds: [] },
    });
    const t = deriveTurn([
      { type: "result", turnId: T, meta: meta("a1"), card: visit(1) },
      { type: "result", turnId: T, meta: meta("a2"), card: { kind: "venues", venues: [] } },
      { type: "result", turnId: T, meta: meta("a1"), card: visit(2) },
    ]);
    expect(t.results).toHaveLength(2);
    const v = t.results.find((r) => r.card.kind === "visit")!;
    expect(v.card.kind === "visit" && v.card.result.audit.warnings).toEqual(["2"]);
    expect(orderResults(t.results).map((r) => r.card.kind)).toEqual(["venues", "visit"]);
  });

  it("all goals satisfied reads as complete; a needs_input goal wins", () => {
    const done = (goals: GoalState[]): AgentEventV2[] => [{ type: "done", turnId: T, goals, memory }];
    expect(turnOutcome(deriveTurn(done([goal("g", "choose_area", "satisfied")])))).toBe("complete");
    expect(turnOutcome(deriveTurn(done([goal("g", "choose_area", "satisfied"), goal("h", "find_venues", "needs_input")])))).toBe("needs_input");
    expect(turnOutcome(deriveTurn(done([goal("g", "choose_area", "failed")])))).toBe("failed");
  });

  it("drops empty claims", () => {
    expect(deriveTurn([{ type: "answer", turnId: T, claims: [{ text: " ", evidenceIds: [] }, { text: "Start in the area.", evidenceIds: ["e1"] }] }]).claims).toHaveLength(1);
  });
});

describe("liveSteps and stale results", () => {
  it("shows running steps and the latest finished ones, at most three, in order", () => {
    const s = (id: string, status: "running" | "done") => ({ id, status, text: id });
    const steps = [s("a", "done"), s("b", "done"), s("c", "done"), s("d", "running")];
    expect(liveSteps(steps).map((x) => x.id)).toEqual(["b", "c", "d"]);
  });
  it("a result for an older revision is stale", () => {
    expect(isStaleResult(meta("a", 2), 3)).toBe(true);
    expect(isStaleResult(meta("a", 3), 3)).toBe(false);
    expect(isStaleResult(meta("a", 3), undefined)).toBe(false);
  });
});

describe("constraint and venue words", () => {
  const c = (kind: Constraint["kind"], value: string | number, strength: Constraint["strength"] = "hard"): Constraint => ({ id: "x", kind, value, strength, source: "user" });
  it("says rules as a person would", () => {
    expect(constraintLabel(c("exclude_type", "bar"))).toBe("No bars");
    expect(constraintLabel(c("exclude_type", "museum"))).toBe("No museums");
    expect(constraintLabel(c("exclude_type", "hotel_bar"))).toBe("No hotel bars");
    expect(constraintLabel(c("exclude_type", "adult"))).toBe("No adult venues");
    expect(constraintLabel(c("budget", 2))).toBe("$$ or less, known prices only");
    expect(constraintLabel(c("budget", 2, "soft"))).toBe("Around $$");
    expect(constraintLabel(c("distance", 1200))).toBe("Within 1.2 km");
    expect(constraintLabel(c("distance", 800))).toBe("Within 800 m");
    expect(constraintLabel(c("dietary", "vegetarian"))).toBe("Vegetarian");
    expect(constraintLabel(c("intent", "dance"))).toBe("Dancing");
  });
  it("never shows a raw place ID", () => {
    expect(constraintLabel(c("exclude_place", "8F1A-22"))).toBe("A place you removed");
    expect(constraintLabel(c("exclude_place", "8F1A-22"), { "8F1A-22": "Café X" })).toBe("Not Café X");
  });
  it("names unknown facts and stays quiet about known-good ones", () => {
    expect(venueStatusLines({ priceStatus: "known_within", hoursStatus: "known_open", insideArea: true, eligibility: "eligible" })).toEqual([]);
    expect(venueStatusLines({ priceStatus: "unknown", hoursStatus: "event_required", insideArea: false, eligibility: "eligible" })).toEqual([
      "Just outside the area",
      "Price not listed",
      "Open for events; check the venue's own listings",
    ]);
  });
  it("turns reason codes into words and passes sentences through", () => {
    expect(unmetText("wifi_unverified")).toBe("wifi is not listed for these cafés");
    expect(unmetText("some_new_code")).toBe("some new code");
    expect(unmetText("No café within 1.2 km")).toBe("No café within 1.2 km");
  });
});

describe("sentences from backend text", () => {
  it("ends with exactly one stop", async () => {
    const { sentence, genreWord, dayNoteLines } = await import("@/lib/explain");
    expect(sentence("This check locates the street.")).toBe("This check locates the street.");
    expect(sentence("no café nearby")).toBe("No café nearby.");
    expect(sentence("Done?")).toBe("Done?");
    expect(genreWord("urn:tag:genre:place:restaurant:pastry_shop")).toBe("pastry shop");
    expect(genreWord(undefined)).toBeNull();
    const lines = dayNoteLines({ neighborhood: "X", stops: [{ time: "14:00", slot: "Coffee", walkMin: 0, place: { id: "p", name: "P", category: "coffee", lat: 0, lon: 0, affinity: 0, popularity: 0, why: [], mapsUrl: "" } }], missing: [], issues: [{ slot: "Explore the neighborhood", reason: "No eligible venue is available for this role." }] }, "Lisbon");
    expect(lines.join(" ")).not.toMatch(/\.\./);
  });
});
