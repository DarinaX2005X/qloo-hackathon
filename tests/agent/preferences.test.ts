import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRequest, StatePatch, type AgentEvent } from "@/shared/contracts";
import { applyPatches } from "@/shared/patches";
import { compactProfile, runAgent } from "@/server/agent/runner";
import { describeChanges, finalFacts, groundedReply, rankingChanged } from "@/server/agent/final";
import { AGENT_TOOLS, createToolContext, executeTool, ToolArguments } from "@/server/agent/tools";
import { chat, type ChatChunk } from "@/server/agent/llm";
import { rankNeighborhoods } from "@/server/engine";
import { searchEntities, searchPlaceTags } from "@/server/qloo";

vi.mock("@/server/agent/llm", () => ({ chat: vi.fn() }));
vi.mock("@/server/qloo", () => ({ searchEntities: vi.fn(), searchPlaceTags: vi.fn() }));
vi.mock("@/server/engine", () => ({ rankNeighborhoods: vi.fn() }));

const state = AgentRequest.shape.state.parse({ city: "Lisbon", budget: 3, loves: [
  { query: "radiohead", chosen: { id: "r", name: "Radiohead", domain: "artist" }, candidates: [], weight: 1 },
  { query: "favourite show", chosen: { id: "f", name: "Fleabag", domain: "tv_show" }, candidates: [], weight: 1 },
  { query: "outdoor gear", chosen: { id: "p", name: "Patagonia", domain: "brand" }, candidates: [], weight: 1 },
] });
const neighborhood = { id: "n", name: "Pena", center: [0, 0] as [number, number], score: 1, you: 1, rank: 1, drivers: [], matchedTags: [], vibe: "local" as const, samplePlaces: [], cellIds: [] };
export async function* noFinalWords(): AsyncGenerator<ChatChunk> { /* Exercise the factual server fallback. */ }
export function queuePlan(ops: StatePatch[], extra: object = {}): void {
  vi.mocked(chat).mockReturnValueOnce(Promise.resolve({ content: JSON.stringify({ ops, ...extra }), tool_calls: [] }));
  vi.mocked(chat).mockReturnValueOnce(noFinalWords());
}
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(rankNeighborhoods).mockResolvedValue([neighborhood]);
});

describe("plan preferences", () => {
  it("exposes all new operations in the generated tool schema and applies them atomically", async () => {
    const schema = JSON.stringify(AGENT_TOOLS.find((tool) => tool.function.name === "apply_changes")!.function.parameters);
    for (const op of ["set_budget", "set_pace", "set_start"]) expect(schema).toContain(op);
    const context = createToolContext(state, new AbortController().signal);
    context.ranking = [neighborhood];
    const result = await executeTool("apply_changes", { ops: [
      { op: "set_budget", budget: 2 }, { op: "set_pace", pace: "relaxed" }, { op: "set_start", hour: 11 },
    ] }, context);
    expect(context.state).toMatchObject({ budget: 2, pace: "relaxed", startHour: 11 });
    expect(context.ranking).toEqual([neighborhood]); expect(result.ops).toHaveLength(3);
  });

  it.each([
    { op: "set_budget", budget: 0 }, { op: "set_budget", budget: 5 }, { op: "set_budget", budget: 1.5 },
    { op: "set_pace", pace: "fast" }, { op: "set_start", hour: 5 }, { op: "set_start", hour: 13 }, { op: "set_start", hour: 7.5 },
  ])("rejects invalid preference data without applying earlier valid operations: %j", async (invalid) => {
    const context = createToolContext(state, new AbortController().signal);
    await expect(executeTool("apply_changes", { ops: [{ op: "set_budget", budget: null }, invalid] }, context)).rejects.toThrow();
    expect(context.state).toEqual(state);
  });

  it("accepts boundary values and null using the shared schema", () => {
    for (const op of [{ op: "set_budget", budget: 1 }, { op: "set_budget", budget: 4 }, { op: "set_budget", budget: null }, { op: "set_start", hour: 6 }, { op: "set_start", hour: 12 }]) {
      expect(ToolArguments.apply_changes.safeParse({ ops: [op] }).success).toBe(true);
    }
  });

  it("includes budget, pace and startHour in the compact model context, including an unset budget", () => {
    expect(compactProfile(state)).toMatchObject({ budget: 3, pace: "balanced", startHour: 9 });
    const withoutBudget = AgentRequest.shape.state.parse({ city: "Lisbon", loves: [] });
    expect(JSON.parse(JSON.stringify(compactProfile(withoutBudget)))).toMatchObject({ budget: null, pace: "balanced", startHour: 9 });
  });

  it.each([
    { op: "set_budget", budget: 2 }, { op: "set_budget", budget: null },
    { op: "set_pace", pace: "relaxed" }, { op: "set_pace", pace: "packed" },
    { op: "set_start", hour: 11 }, { op: "set_start", hour: 7 },
  ] satisfies StatePatch[])("updates plan settings without a lookup or ranking: %j", async (op) => {
    // A model's redundant ranking flag must not trigger a geographic refresh.
    queuePlan([op], { ranking: true });
    const events: AgentEvent[] = [];
    const result = await runAgent(AgentRequest.parse({ state, message: "adjust my plans" }), (event) => events.push(event));
    expect(result).toEqual(applyPatches(state, [op]));
    expect(rankNeighborhoods).not.toHaveBeenCalled(); expect(searchEntities).not.toHaveBeenCalled(); expect(searchPlaceTags).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "patch")).toBe(true);
    const text = events.filter((event) => event.type === "delta").map((event) => event.text).join("");
    expect(text).toMatch(/plan/i); expect(text).not.toMatch(/neighborhood|ranking|Pena/i);
  });

  it("keeps plan-only changes out of the ranking comparison but includes taste changes", () => {
    const planOnly = applyPatches(state, [
      { op: "set_budget", budget: null }, { op: "set_pace", pace: "packed" }, { op: "set_start", hour: 7 }, { op: "set_days", days: 3 },
    ]);
    expect(rankingChanged(state, planOnly)).toBe(false);
    expect(rankingChanged(state, applyPatches(planOnly, [{ op: "set_discovery", value: 0.7 }]))).toBe(true);
    expect(rankingChanged(state, applyPatches(state, [{ op: "remove_love", query: "Fleabag" }]))).toBe(true);
    expect(rankingChanged(state, applyPatches(state, [{ op: "set_weight", query: "Radiohead", weight: 0.5 }]))).toBe(true);
  });

  it("ranks a mixed request once after all settings are applied", async () => {
    const ops: StatePatch[] = [{ op: "set_discovery", value: 0.7 }, { op: "set_budget", budget: 2 }, { op: "set_start", hour: 11 }];
    queuePlan(ops);
    const events: AgentEvent[] = [];
    await runAgent(AgentRequest.parse({ state, message: "less touristy, on a budget, I sleep late" }), (event) => events.push(event));
    expect(rankNeighborhoods).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ discovery: 0.7, budget: 2, startHour: 11 }));
    const text = events.filter((event) => event.type === "delta").map((event) => event.text).join("");
    expect(text).toContain("$$"); expect(text).toContain("11:00"); expect(text).toContain("Pena");
  });

  it.each([
    { op: "remove_love", query: "Fleabag" }, { op: "remove_love", query: "outdoor gear" }, { op: "set_weight", query: "Radiohead", weight: 0.5 },
  ] satisfies StatePatch[])("removes/reweights existing tastes without searching: %j", async (op) => {
    queuePlan([op]);
    const result = await runAgent(AgentRequest.parse({ state, message: "update my tastes" }), () => {});
    expect(result).toEqual(applyPatches(state, [op])); expect(searchEntities).not.toHaveBeenCalled();
    expect(rankNeighborhoods).toHaveBeenCalledTimes(1);
  });

  it("describes the actual price cap, local start time and pace without inventing a district", () => {
    const after = applyPatches(state, [{ op: "set_budget", budget: 2 }, { op: "set_start", hour: 11 }, { op: "set_pace", pace: "relaxed" }]);
    const facts = finalFacts(state, after, null);
    expect(facts.rankingUnavailable).toBe(false);
    expect(groundedReply(facts)).toContain("$$"); expect(groundedReply(facts)).toContain("11:00"); expect(groundedReply(facts)).toContain("relaxed");
    expect(describeChanges(state, { ...state, budget: null })).toEqual(["Set plans to use any price level"]);
  });
});
