import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRequest, type AgentEvent, type EntityRef } from "@/shared/contracts";
import { ChangePlan, executePlan, makePlan, selectPlaceTags } from "@/server/agent/plan";
import { appliedReferences, runAgent } from "@/server/agent/runner";
import { createToolContext } from "@/server/agent/tools";
import { chat, type ChatChunk } from "@/server/agent/llm";
import { searchEntities, searchPlaceTags } from "@/server/qloo";
import { rankNeighborhoods } from "@/server/engine";

vi.mock("@/server/agent/llm", () => ({ chat: vi.fn() }));
vi.mock("@/server/qloo", () => ({ searchEntities: vi.fn(), searchPlaceTags: vi.fn() }));
vi.mock("@/server/engine", () => ({ rankNeighborhoods: vi.fn() }));
const input = AgentRequest.parse({ state: { city: "Lisbon", loves: [] }, message: "Add my partner: techno and Succession", history: [] });
const entities: EntityRef[] = [{ id: "ben", name: "Ben Klock", domain: "artist" }, { id: "nina", name: "Nina Kraviz", domain: "artist" }, { id: "succession", name: "Succession", domain: "tv_show" }];
const genrePlan = { entities: entities.map((entity, i) => ({ name: entity.name, domain: entity.domain, target: "partner", ...(i < 2 ? { reference_for: "techno" } : {}) })) };

export async function* finalChunks(): AsyncGenerator<ChatChunk> {
  yield { type: "content", text: "For techno I used Ben Klock and Nina Kraviz as reference points, and added Succession. " };
  yield { type: "content", text: "Santa Catarina is your shared best start." };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(searchEntities).mockImplementation(async (query) => entities.filter((entity) => entity.name === query));
  vi.mocked(searchPlaceTags).mockResolvedValue([]);
});

describe("compact change plans", () => {
  it("performs one short JSON planning call with no graph ids supplied by the model", async () => {
    vi.mocked(chat).mockReturnValueOnce(Promise.resolve({ content: JSON.stringify(genrePlan), tool_calls: [] }));
    expect((await makePlan(input, {}, new AbortController().signal))?.entities).toHaveLength(3);
    expect(vi.mocked(chat).mock.calls[0][0]).toMatchObject({ response_format: { type: "json_object" }, max_tokens: 650 });
  });

  it("normalizes the model's type alias through the existing patch schema", async () => {
    vi.mocked(chat).mockReturnValueOnce(Promise.resolve({ content: '{"ops":[{"type":"set_days","days":3}]}', tool_calls: [] }));
    expect((await makePlan(input, {}, new AbortController().signal))?.ops).toEqual([{ op: "set_days", days: 3 }]);
  });

  it("resolves all genre representatives concurrently, applies authoritative loves, and records attribution", async () => {
    const context = createToolContext(input.state, new AbortController().signal);
    const events: AgentEvent[] = [];
    const result = await executePlan(ChangePlan.parse(genrePlan), context, (event) => events.push(event));
    expect(result).toEqual({ applied: true, refresh: true });
    expect(searchEntities).toHaveBeenCalledTimes(3);
    expect(context.state.companion?.loves.map((love) => love.chosen?.name)).toEqual(["Ben Klock", "Nina Kraviz", "Succession"]);
    expect(appliedReferences(context)).toEqual([{ taste: "techno", names: ["Ben Klock", "Nina Kraviz"] }]);
    expect(events.map((event) => event.type)).toEqual(["trace", "trace", "trace", "trace", "patch"]);
  });

  it("preserves requested order rather than network completion order", async () => {
    let release!: (entities: EntityRef[]) => void;
    vi.mocked(searchEntities).mockImplementation(async (name) => name === "Ben Klock" ? new Promise((resolve) => { release = resolve; }) : entities.filter((entity) => entity.name === name));
    const context = createToolContext(input.state, new AbortController().signal);
    const pending = executePlan(ChangePlan.parse(genrePlan), context, () => {});
    expect(searchEntities).toHaveBeenCalledTimes(3); release([entities[0]]); await pending;
    expect(context.state.companion?.loves.map((love) => love.query)).toEqual(["Ben Klock", "Nina Kraviz", "Succession"]);
  });

  it("does not retain an unresolved representative when another one for the genre resolved", async () => {
    vi.mocked(searchEntities).mockImplementation(async (name) => entities.filter((entity) => entity.name === name && name !== "Nina Kraviz"));
    const context = createToolContext(input.state, new AbortController().signal);
    await executePlan(ChangePlan.parse(genrePlan), context, () => {});
    expect(context.state.companion?.loves.map((love) => love.chosen?.name)).toEqual(["Ben Klock", "Succession"]);
  });

  it("finds relevant wifi/cafe tags and never adds more than two", async () => {
    const tags = ["Parking", "Wifi", "Wi-Fi", "Cafe", "Free Wifi", "Laptop friendly"].map((name, i) => ({ id: String(i), name, kind: "amenity" }));
    expect(selectPlaceTags(tags, ["wifi", "cafe"]).map((tag) => tag.name).sort()).toEqual(["Cafe", "Free Wifi"]);
    vi.mocked(searchPlaceTags).mockResolvedValue(tags);
    const context = createToolContext(input.state, new AbortController().signal);
    await executePlan(ChangePlan.parse({ place_queries: ["free wifi", "cafe"] }), context, () => {});
    expect(searchPlaceTags).toHaveBeenCalledWith("wifi"); expect(context.state.refinements).toHaveLength(2);
  });

  it("needs exactly two model calls for the partner request and emits streamed final words", async () => {
    vi.mocked(chat).mockReturnValueOnce(Promise.resolve({ content: JSON.stringify(genrePlan), tool_calls: [] })).mockReturnValueOnce(finalChunks());
    vi.mocked(rankNeighborhoods).mockResolvedValue([{ id: "n", name: "Santa Catarina", center: [0, 0], score: 1, you: 1, rank: 1, drivers: [], matchedTags: [], vibe: "local", samplePlaces: [], cellIds: [] }]);
    const events: AgentEvent[] = [];
    const result = await runAgent(input, (event) => events.push(event));
    expect(result.companion?.loves.every((love) => love.chosen)).toBe(true);
    expect(chat).toHaveBeenCalledTimes(2); expect(vi.mocked(chat).mock.calls[1][0]).toMatchObject({ stream: true, max_tokens: 120 });
    expect(events.filter((event) => event.type === "delta")).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("keeps confirmed changes when the engine reaches the whole-request deadline", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(chat).mockReturnValueOnce(Promise.resolve({ content: '{"ops":[{"op":"set_discovery","value":0.7}]}', tool_calls: [] }));
      vi.mocked(rankNeighborhoods).mockReturnValue(new Promise(() => {}));
      const events: AgentEvent[] = [];
      const pending = runAgent(input, (event) => events.push(event));
      await vi.advanceTimersByTimeAsync(25_000);
      expect((await pending).discovery).toBe(0.7);
      expect(events.at(-1)).toEqual({ type: "done" });
      expect(events.filter((event) => event.type === "delta").map((event) => event.text).join("")).toContain("ranking is not available");
      expect(chat).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
