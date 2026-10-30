import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, type EntityRef } from "@/shared/contracts";
import { AgentEventV2, AgentRequestV2, emptySessionMemory, type AnalysisRequestV2, type ResultMeta, type VenueEvidence } from "@/shared/contracts-09";
import { FICTIONAL_COMPLETE_09 as fixture } from "@/shared/fixtures-09";
import { profileHash } from "@/server/engine/09/core";
import { runAgentV2, serializeEventV2 } from "@/server/agent/09/runner";
import { clearAgentMemory } from "@/server/agent/09/memory";
import { DecisionPlan, planGoals, type RecoveryOption } from "@/server/agent/09/planning";
import { mergeConstraints, userConstraint } from "@/server/agent/09/constraints";
import { prepareProfile, type PreparationServices } from "@/server/agent/09/prepare";
import type { Services } from "@/server/agent/09/tools";

// Fixtures remain fictional test data. Add role metadata so the audit can independently check them.
const validVenue = (venue: VenueEvidence): VenueEvidence => ({ ...venue, place: { ...venue.place, primaryGenre: venue.role === "coffee" ? "coffee_shop" : venue.role === "food" ? "restaurant" : "book_store", classifications: [venue.role === "coffee" ? "coffee_shop" : venue.role === "food" ? "restaurant" : "book_store"] } });
const area = (value: typeof fixture.neighborhoods.areas[number]) => ({ ...value, anchors: value.anchors.map(validVenue) });
const data = {
  rank_areas: { ...fixture.neighborhoods, areas: fixture.neighborhoods.areas.map(area) },
  translate_home: { ...fixture.home, matches: fixture.home.matches.map(m => ({ ...m, area: area(m.area), counterparts: m.counterparts.map(p => ({ ...p, target: validVenue(p.target) })) })) },
  explain_area: fixture.explanation, compare_cities: fixture.comparison,
  evaluate_address: { ...fixture.address, nearby: fixture.address.nearby.map(n => ({ ...n, venue: validVenue(n.venue) })) },
  find_venues: { ...fixture.places, venues: fixture.places.venues.map(validVenue) },
  build_visit: { ...fixture.visit, venueEvidence: Object.fromEntries(Object.entries(fixture.visit.venueEvidence).map(([id, v]) => [id, validVenue(v)])) },
};
let sequence = 0;
function stamp<T extends { meta: ResultMeta }>(value: T, input: AnalysisRequestV2): T {
  return structuredClone({ ...value, meta: { ...value.meta, stateRevision: input.stateRevision, profileHash: profileHash(input.state, input.constraints), analysisId: `fictional:result:${++sequence}` } });
}
function implementations() {
  return Object.fromEntries(Object.entries(data).map(([tool, value]) => [tool, vi.fn(async (input: AnalysisRequestV2) => stamp(value, input))])) as unknown as { [K in keyof Services]: ReturnType<typeof vi.fn<Services[K]>> };
}
const preparation: PreparationServices = {
  search: vi.fn(async (name: string) => [{ id: `fictional:${name}`, name, domain: "artist" }] as EntityRef[]),
  validateCity: vi.fn(async (name: string) => ({ name, label: "Fictional Country", query: name, center: [0, 0] as [number, number] })),
  tags: vi.fn(async () => ({ tags: [{ id: "urn:tag:genre:music:techno", name: "Techno", kind: "genre" }], evidence: fixture.places.evidence })),
};
const request = (message: string, extra: Partial<AgentRequestV2> = {}) => AgentRequestV2.parse({ responseVersion: 2, sessionId: "fictional:session", turnId: `fictional:turn:${++sequence}`, stateRevision: 1, state: fixture.state, memory: emptySessionMemory(1), history: [], message, ...extra });
const model = (value: unknown) => vi.fn(async () => DecisionPlan.parse(value));
const keep = vi.fn(async (options: RecoveryOption[]) => ({ action: "keep_partial" as const, goalId: options[0].goalId }));
beforeEach(() => { sequence = 0; clearAgentMemory(); vi.clearAllMocks(); });

describe("v2 agent goal loop", () => {
  it("honors elapsed deadlines even when a delayed timer has not fired", async () => {
    const api = implementations(), events: AgentEventV2[] = [];
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const result = await runAgentV2(request("Where should I start looking?"), e => events.push(e), undefined, {
        services: api, preparation, recovery: keep, deadlineMs: 50,
        plan: async () => { clock = 100; return DecisionPlan.parse({ goals: ["choose_area"] }); },
      });
      expect(api.rank_areas).not.toHaveBeenCalled();
      expect(result.goals[0].status).toBe("failed");
      expect(events.some(e => e.type === "error" && e.retryable && e.message.includes("timed out"))).toBe(true);
      expect(events.at(-1)?.type).toBe("done");
    } finally { now.mockRestore(); }
  });
  it("keeps qualified exclusions from growing into bans on all clubs, bars or culture", () => {
    const message = "No hotel bars, no adult clubs, and no museums.";
    const plan = DecisionPlan.parse({ constraints: [
      { kind: "exclude_type", value: "bars", strength: "hard", sourceText: "No hotel bars" },
      { kind: "exclude_type", value: "clubs", strength: "hard", sourceText: "no adult clubs" },
      { kind: "exclude_type", value: "culture", strength: "hard", sourceText: "no museums" },
    ] });
    expect(mergeConstraints([], plan, message).map(c => c.value).sort()).toEqual(["adult", "hotel", "museums"]);
    expect(mergeConstraints([], DecisionPlan.parse({}), "My partner doesn't like clubs.").map(c => c.value)).toEqual(["clubs"]);
  });
  it("publishes an early verified card while enrichment is pending, then replaces it under one result ID", async () => {
    const api = implementations(), events: AgentEventV2[] = [];
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    api.rank_areas.mockImplementation(async (input, progress) => {
      const initial = stamp(data.rank_areas, input); initial.meta.status = "partial";
      progress?.(initial); await waiting;
      return { ...initial, meta: { ...initial.meta, status: "complete" } };
    });
    const running = runAgentV2(request("Choose an area to explore."), e => events.push(e), undefined, { services: api, preparation, recovery: keep, plan: model({ goals: ["choose_area"] }) });
    await vi.waitFor(() => expect(events.some(e => e.type === "result")).toBe(true));
    expect(events.some(e => e.type === "done")).toBe(false);
    finish(); const settled = await running;
    const cards = events.filter(e => e.type === "result");
    expect(cards).toHaveLength(2); expect(cards[0].meta.analysisId).toBe(cards[1].meta.analysisId);
    expect(settled.goals[0].resultIds).toHaveLength(1);
  });
  it("cannot silently drop a partner activity follow-up even when the model returns no goals", async () => {
    const api = implementations(), events: AgentEventV2[] = [];
    const result = await runAgentV2(request("My partner doesn't like clubs. What could we do near our shortlist together?"), e => events.push(e), undefined, { services: api, preparation, recovery: keep, plan: model({}) });
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]).toMatchObject({ kind: "find_venues", status: "satisfied" });
    expect(api.find_venues.mock.calls[0][0]).toMatchObject({ intent: "daily_life", constraints: expect.arrayContaining([expect.objectContaining({ kind: "exclude_type", value: "clubs" })]) });
    expect(events.some(e => e.type === "result" && e.card.kind === "venues")).toBe(true);
    expect(events.filter(e => e.type === "answer").flatMap(e => e.claims).some(c => c.text.includes("requirements are saved"))).toBe(false);
  });
  it("streams a completed address card while a visit is still pending", async () => {
    const api = implementations(), events: AgentEventV2[] = [];
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    api.build_visit.mockImplementation(async input => { await waiting; return stamp(data.build_visit, input); });
    const running = runAgentV2(request("Check Rua da Rosa 120 and plan an afternoon visit."), e => events.push(e), undefined, { services: api, preparation, recovery: keep, plan: model({ address: "Rua da Rosa 120", visit: { startHour: 14 } }) });
    await vi.waitFor(() => expect(api.build_visit).toHaveBeenCalledOnce());
    expect(events.some(e => e.type === "result" && e.card.kind === "address")).toBe(true);
    expect(events.some(e => e.type === "done")).toBe(false);
    finish(); await running;
  });
  it("acknowledges immediately and retains all compound goals when a later provider fails", async () => {
    const api = implementations(); api.build_visit.mockRejectedValue(apiError("quota", "The visit provider is busy.", true));
    const events: AgentEventV2[] = [];
    const pending = runAgentV2(request("Find the closest area like home, check Rua da Rosa 120, then plan two days."), e => events.push(e), undefined, {
      services: api, preparation, recovery: keep, plan: model({ source: { city: "Fictional Old City", neighborhood: "Fictional Old Quarter" }, address: "Rua da Rosa 120", visit: { days: 2 } }),
    });
    expect(events[0].type).toBe("ack");
    const result = await pending;
    expect(result.goals.map(g => g.kind).sort()).toEqual(["build_visit", "choose_area", "evaluate_address"]);
    expect(events.filter(e => e.type === "result").map(e => e.card.kind)).toEqual(["home", "address"]);
    expect(result.goals.find(g => g.kind === "build_visit")).toMatchObject({ status: "failed", unmet: ["The visit provider is busy."] });
    expect(events.at(-1)?.type).toBe("done");
    expect(events.every(e => AgentEventV2.safeParse(e).success)).toBe(true);
  });
  it("never changes the map for a comparison, even if the model proposes set_city", async () => {
    const api = implementations(), input = request("Would Lisbon or Berlin feel closer to my old neighborhood?");
    const result = await runAgentV2(input, () => {}, undefined, { services: api, preparation, recovery: keep, plan: model({ cities: ["Lisbon", "Berlin"], goals: ["compare_cities", "choose_area"], explain: true, ops: [{ op: "set_city", city: "Berlin" }] }) });
    expect(result.state.city).toBe(input.state.city);
    expect(result.goals.map(g => g.kind)).toEqual(["compare_cities"]);
    expect(api.rank_areas).not.toHaveBeenCalled(); expect(api.explain_area).not.toHaveBeenCalled();
    expect(api.compare_cities).toHaveBeenCalledOnce(); expect(preparation.validateCity).not.toHaveBeenCalled();
  });
  it("commits constraints and revision before returning any result, and carries them into the next turn", async () => {
    const api = implementations(), events: AgentEventV2[] = [];
    const first = await runAgentV2(request("Check Rua da Rosa 120, no bars, within $$ where you know the price."), e => events.push(e), undefined, { services: api, preparation, recovery: keep, plan: model({ address: "Rua da Rosa 120" }) });
    const patch = events.find(e => e.type === "patch")!;
    expect(patch).toMatchObject({ baseRevision: 1, nextRevision: 2, constraints: expect.arrayContaining([expect.objectContaining({ kind: "exclude_type", value: "bars" }), expect.objectContaining({ kind: "budget", value: 2 })]) });
    expect(events.indexOf(patch)).toBeLessThan(events.findIndex(e => e.type === "result"));
    const second = await runAgentV2(request("Plan a relaxed afternoon nearby.", { state: first.state, stateRevision: first.memory.revision, memory: first.memory }), () => {}, undefined, { services: api, preparation, recovery: keep, plan: model({ visit: { days: 1, startHour: 14 } }) });
    expect(api.build_visit.mock.calls[0][0]).toMatchObject({ constraints: first.memory.constraints, startHour: 14, areaIds: [fixture.address.area!.area.id] });
    expect(second.memory.constraints).toEqual(first.memory.constraints);
  });
  it("runs the explicitly requested weak-Home blend before the dependent visit without a model veto", async () => {
    const api = implementations(), order: string[] = [], events: AgentEventV2[] = [];
    api.translate_home.mockImplementation(async input => {
      order.push(`home:${input.lambda}`);
      return stamp({ ...data.translate_home, matches: data.translate_home.matches.map(m => ({ ...m, similarity: { ...m.similarity, value: 24 }, ...(input.lambda ? { orderReason: "home_personal_blend" as const } : {}) })) }, input);
    });
    api.build_visit.mockImplementation(async input => { order.push("visit"); return stamp(data.build_visit, input); });
    await runAgentV2(request("Find an area like home, use my tastes if weak, then plan a visit."), e => events.push(e), undefined, { services: api, preparation, recovery: keep, plan: model({ source: { city: "Fictional Old City", neighborhood: "Fictional Old Quarter" }, visit: { days: 1 } }) });
    expect(order).toEqual(["home:0", "home:0.35", "visit"]); expect(keep).not.toHaveBeenCalled();
    expect(events.some(e => e.type === "replan" && e.nextAction.includes("35%"))).toBe(true);
    expect(events.filter(e => e.type === "result" && e.card.kind === "home")).toHaveLength(2);
    expect(events.filter(e => e.type === "answer").flatMap(e => e.claims).some(c => c.text.includes("Home alone") && c.text.includes("35%") && c.text.includes("24.0/100"))).toBe(true);
  });
  it("retries one failed goal without repeating the completed address", async () => {
    const api = implementations(); api.build_visit.mockRejectedValueOnce(apiError("qloo_unavailable", "Visit unavailable", true));
    const first = await runAgentV2(request("Check Rua da Rosa 120, then plan a visit."), () => {}, undefined, { services: api, preparation, recovery: keep, plan: model({ address: "Rua da Rosa 120", visit: { days: 1 } }) });
    const target = first.goals.find(g => g.kind === "build_visit")!;
    const nextModel = model({});
    const retried = await runAgentV2(request("Try that step again.", { retryGoalId: target.id, state: first.state, memory: first.memory, stateRevision: first.memory.revision }), () => {}, undefined, { services: api, preparation, recovery: keep, plan: nextModel });
    expect(api.evaluate_address).toHaveBeenCalledOnce(); expect(api.build_visit).toHaveBeenCalledTimes(2); expect(nextModel).not.toHaveBeenCalled();
    expect(retried.goals).toHaveLength(1); expect(retried.goals[0].status).toBe("satisfied");
  });
  it("retries failed planning with the original request and still resolves its explicit loves", async () => {
    const api = implementations(), original = request("I love Radiohead. Where should I start looking?");
    const failed = await runAgentV2(original, () => {}, undefined, { services: api, preparation, recovery: keep, plan: vi.fn(async () => { throw apiError("llm_unavailable", "Planner unavailable", true); }) });
    const planner = vi.fn(async (input: AgentRequestV2) => { expect(input.message).toBe(original.message); return DecisionPlan.parse({ entities: [{ name: "Radiohead", domain: "artist" }], goals: ["choose_area"] }); });
    const retried = await runAgentV2(request("Try this step again.", { retryGoalId: failed.goals[0].id, memory: failed.memory, state: failed.state }), () => {}, undefined, { services: api, preparation, recovery: keep, plan: planner });
    expect(planner).toHaveBeenCalledOnce();
    expect(preparation.search).toHaveBeenCalledWith("Radiohead", "artist");
    expect(retried.goals).toHaveLength(1); expect(api.rank_areas).toHaveBeenCalledOnce();
  });
  it("uses genre tags temporarily and rejects unrequested stand-in artists", async () => {
    const api = implementations();
    const result = await runAgentV2(request("Where can I go dancing? I want dark techno."), () => {}, undefined, { services: api, preparation, recovery: keep, plan: model({ entities: [{ name: "Ben Klock", domain: "artist" }], venues: { intent: "dance", temporaryIntent: "dark techno" } }) });
    expect(result.state.loves).toEqual(fixture.state.loves);
    expect(preparation.search).not.toHaveBeenCalled(); expect(api.find_venues.mock.calls[0][0].temporaryTagIds).toEqual(["urn:tag:genre:music:techno"]);
    expect(result.goals[0].unmet.join(" ")).toContain("not an explicitly named love");
  });
  it("rejects a stale provider envelope instead of emitting its card", async () => {
    const api = implementations(), events: AgentEventV2[] = [];
    api.rank_areas.mockResolvedValue({ ...data.rank_areas, meta: { ...data.rank_areas.meta, stateRevision: 999 } });
    const result = await runAgentV2(request("Where should I start looking?"), e => events.push(e), undefined, { services: api, preparation, recovery: keep, plan: model({ goals: ["choose_area"] }) });
    expect(events.some(e => e.type === "result")).toBe(false); expect(result.goals[0].status).toBe("failed");
  });
  it("does not turn a model's omitted address into a silently completed compound request", async () => {
    const api = implementations();
    const result = await runAgentV2(request("Check Rua da Rosa 120 then plan a relaxed afternoon nearby."), () => {}, undefined, { services: api, preparation, recovery: keep, plan: model({ visit: { days: 1 } }) });
    expect(result.goals.map(g => g.kind).sort()).toEqual(["build_visit", "evaluate_address"]);
    expect(result.goals.every(g => g.status === "needs_input")).toBe(true); expect(api.build_visit).not.toHaveBeenCalled();
  });
  it("keeps completed cards on timeout and stops after client cancellation", async () => {
    const api = implementations(), events: AgentEventV2[] = [];
    api.build_visit.mockImplementation(async () => new Promise(() => {}));
    const result = await runAgentV2(request("Check Rua da Rosa 120 then plan a visit."), e => events.push(e), undefined, { services: api, preparation, recovery: keep, deadlineMs: 25, plan: model({ address: "Rua da Rosa 120", visit: {} }) });
    expect(events.filter(e => e.type === "result").map(e => e.card.kind)).toEqual(["address"]);
    expect(result.goals.find(g => g.kind === "build_visit")?.status).toBe("failed"); expect(events.at(-1)?.type).toBe("done");
    const errors = events.filter(e => e.type === "error");
    expect(new Set(errors.map(e => `${e.goalId}:${e.message}`)).size).toBe(errors.length);
    const answerText = events.filter(e => e.type === "answer").flatMap(e => e.claims).map(c => c.text).join(" ");
    expect(answerText).not.toContain("The remaining checks timed out");
    expect(events.filter(e => e.type === "step" && e.stepId.includes(":step:")).at(-1)).toMatchObject({ status: "failed" });
    const controller = new AbortController(), cancelled: AgentEventV2[] = [];
    await runAgentV2(request("Find places"), e => { cancelled.push(e); if (e.type === "ack") controller.abort(); }, controller.signal, { services: api, preparation, recovery: keep, plan: model({ venues: { intent: "coffee" } }) });
    expect(cancelled.map(e => e.type)).toEqual(["ack"]);
  });
  it("bounds a stuck recovery and preserves the usable result without late events", async () => {
    const api = implementations(), events: AgentEventV2[] = [];
    api.find_venues.mockImplementation(async input => stamp({ ...data.find_venues, venues: [], unmet: ["Fictional sparse pool"] }, input));
    let finish!: (choice: { action: "wider_venue_search"; goalId: string }) => void;
    const recovery = vi.fn(() => new Promise<{ action: "wider_venue_search"; goalId: string }>(resolve => { finish = resolve; }));
    // Make the recovery budget available, then simulate elapsed time advancing
    // through a stuck model by aborting the real deadline early in the mock.
    vi.useFakeTimers();
    try {
      const running = runAgentV2(request("Find coffee"), e => events.push(e), undefined, { services: api, preparation, recovery, deadlineMs: 7000, plan: model({ venues: { intent: "coffee" } }) });
      await vi.advanceTimersByTimeAsync(0);
      expect(recovery).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(7001);
      const result = await running;
      expect(result.goals[0].status).toBe("partial");
      expect(events.at(-1)?.type).toBe("done");
      const count = events.length;
      finish({ action: "wider_venue_search", goalId: result.goals[0].id });
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toHaveLength(count);
      expect(api.find_venues).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("serializes the event name separately and carries the turn identifier", () => {
    const sse = serializeEventV2({ type: "ack", turnId: "fictional:turn", text: "Accepted" });
    expect(sse).toBe('event: ack\ndata: {"turnId":"fictional:turn","text":"Accepted"}\n\n');
  });
});

describe("explicit inputs and independent lookup failures", () => {
  it("keeps a resolved love when a different independent lookup fails", async () => {
    const search = vi.fn(async (name: string) => { if (name === "Missing") throw apiError("qloo_unavailable", "Unavailable", true); return [{ id: "fictional:radiohead", name, domain: "artist" as const }]; });
    const result = await prepareProfile(request("I love Radiohead and Missing"), DecisionPlan.parse({ entities: [{ name: "Radiohead" }, { name: "Missing" }] }), new AbortController().signal, () => {}, { ...preparation, search });
    expect(result.state.loves.some(l => l.chosen?.name === "Radiohead")).toBe(true); expect(result.unresolved.join(" ")).toContain("Missing");
  });
  it("retains restrictions through unrelated turns and requires a current quote to revoke them", () => {
    const current = [userConstraint("exclude_type", "bars")];
    expect(mergeConstraints(current, DecisionPlan.parse({ removeConstraints: [{ id: current[0].id, sourceText: "bars are fine" }] }), "Find coffee")).toEqual(current);
    expect(mergeConstraints(current, DecisionPlan.parse({ removeConstraints: [{ id: current[0].id, sourceText: "Find coffee" }] }), "Find coffee")).toEqual(current);
    expect(mergeConstraints(current, DecisionPlan.parse({ removeConstraints: [{ id: current[0].id, sourceText: "bars are fine" }] }), "Actually, bars are fine now.")).toEqual([]);
    expect(planGoals(DecisionPlan.parse({}), "Check the flat then plan two days, no bars.")).toEqual(["evaluate_address", "build_visit"]);
  });
});
