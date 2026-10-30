import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRequest, type AgentEvent, type HomeResult, type Neighborhood, type SpotResult } from "@/shared/contracts";
import { runAgent, serializeEvent } from "@/server/agent/runner";
import { chat, type ChatChunk } from "@/server/agent/llm";
import { findHome } from "@/server/engine/home";
import { checkSpot } from "@/server/engine/spot";
import { whatDecides } from "@/server/engine/decides";
import { placesNear } from "@/server/engine/places";
import { rankNeighborhoods } from "@/server/engine";
import { place } from "../server/helpers";

vi.mock("@/server/agent/llm", () => ({ chat: vi.fn() }));
vi.mock("@/server/engine/home", () => ({ findHome: vi.fn() }));
vi.mock("@/server/engine/spot", () => ({ checkSpot: vi.fn() }));
vi.mock("@/server/engine/decides", () => ({ whatDecides: vi.fn() }));
vi.mock("@/server/engine/places", () => ({ placesNear: vi.fn() }));
vi.mock("@/server/engine", () => ({ rankNeighborhoods: vi.fn() }));
const area: Neighborhood = { id: "santa", name: "Santa Catarina", center: [0, 0], score: 0.86, you: 0.86, rank: 1,
  drivers: [{ love: "Radiohead", domain: "artist", share: 1 }], matchedTags: ["Cozy"], vibe: "local", samplePlaces: [], cellIds: [] };
const homeResult: HomeResult = { source: { city: "Berlin", neighborhood: "Kreuzberg", center: [0, 0], places: [], tags: ["Cozy"] },
  field: { city: "Lisbon", center: [0, 0], bbox: [0, 0, 0, 0], cells: [], sparse: true, signalsWithoutGeo: [] }, neighborhoods: [area],
  matches: [{ neighborhoodId: area.id, similarity: 86, sharedTags: ["Cozy"], twins: [] }] };
const spotResult: SpotResult = { label: "Street 12", point: [0, 0], score: 0.8, percentile: 86, neighborhood: { id: area.id, name: area.name, rank: 1 },
  drivers: [], walk: [], counts: { coffee: 0, food: 0, drinks: 0, culture: 0, openLate: 0 }, verdict: "Better than 86% of mapped Lisbon for your taste." };
const input = AgentRequest.parse({ state: { city: "Lisbon", loves: [] }, message: "test" });
const text = (events: AgentEvent[]) => events.filter((e) => e.type === "delta").map((e) => e.text).join("");
const plan = (value: unknown) => vi.mocked(chat).mockResolvedValueOnce({ content: JSON.stringify(value), tool_calls: [] });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(findHome).mockResolvedValue(homeResult); vi.mocked(checkSpot).mockResolvedValue(spotResult);
  vi.mocked(whatDecides).mockResolvedValue({ neighborhoods: [], pivotal: "Radiohead", robust: false, summary: "Santa Catarina loses first place without Radiohead (to #3)." });
  vi.mocked(rankNeighborhoods).mockResolvedValue([area]); vi.mocked(placesNear).mockResolvedValue([place("Real Dinner", { category: "food", why: ["Cozy"] })]);
});

describe("07 fuller agent", () => {
  it.each([
    ["find_home", { city: "Berlin", neighborhood: "Kreuzberg" }, "home", "86/100"],
    ["check_address", { query: "Street 12" }, "spot", "86%"],
    ["what_decides", {}, "decides", "#3"],
  ] as const)("runs %s on the fast path and emits a grounded card before text without patches", async (name, args, kind, evidence) => {
    plan({ [name]: args, reply: "Invented City has a score of 100." });
    const events: AgentEvent[] = [];
    expect(await runAgent(input, (event) => events.push(event))).toEqual(input.state);
    expect(vi.mocked(chat)).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(["trace", "trace", "trace", "card", "delta", "done"]);
    expect(events.find((event) => event.type === "card")).toMatchObject({ card: { kind } });
    expect(text(events)).toContain(evidence); expect(text(events)).not.toContain("Invented");
    expect(events.some((event) => event.type === "patch")).toBe(false);
  });
  it("answers what an area is like from current ranking evidence without a mutation or refusal", async () => {
    plan({ explain_neighborhood: { id: "Santa Catarina" } });
    const events: AgentEvent[] = [];
    await runAgent(input, (event) => events.push(event));
    expect(text(events)).toContain("Cozy"); expect(text(events)).toContain("Radiohead"); expect(text(events)).toContain("#1");
    expect(text(events)).not.toContain("rephrase"); expect(rankNeighborhoods).toHaveBeenCalledTimes(1);
  });
  it("answers dinner requests with actual place results and preserves the profile", async () => {
    plan({ get_places: { categories: ["food"] } });
    const events: AgentEvent[] = [];
    expect(await runAgent(input, (event) => events.push(event))).toEqual(input.state);
    expect(text(events)).toContain("Real Dinner (Cozy)");
    expect(placesNear).toHaveBeenCalledWith(input.state, area, ["food"]);
    expect(chat).toHaveBeenCalledTimes(1);
  });
  it("emits the new ranking card after patches and before a requested feature card", async () => {
    plan({ ops: [{ op: "set_discovery", value: 0.8 }], what_decides: {} });
    const events: AgentEvent[] = [];
    await runAgent(input, (event) => events.push(event));
    const sequence = events.filter((event) => event.type !== "trace").map((event) => event.type === "card" ? `card:${event.card.kind}` : event.type);
    expect(sequence).toEqual(["patch", "card:ranking", "card:decides", "delta", "done"]);
    expect(whatDecides).toHaveBeenCalledWith(expect.objectContaining({ discovery: 0.8 }));
  });
  it("supports new tools in the fallback loop and discards unsupported pre-tool prose", async () => {
    plan({ use_tools: true });
    async function* chunks(): AsyncGenerator<ChatChunk> {
      yield { type: "content", text: "Made-up place is perfect." };
      yield { type: "tool_call", call: { id: "read", type: "function", function: { name: "check_address", arguments: '{"query":"Street 12"}' } } };
    }
    vi.mocked(chat).mockReturnValueOnce(chunks());
    const events: AgentEvent[] = [];
    await runAgent(input, (event) => events.push(event));
    expect(chat).toHaveBeenCalledTimes(2); expect(text(events)).toBe(spotResult.verdict);
    expect(events.find((e) => e.type === "card")).toMatchObject({ card: { kind: "spot" } });
  });
  it("reports a timed-out read as an error without falsely saying no changes could be applied", async () => {
    vi.useFakeTimers();
    try {
      plan({ check_address: { query: "Street 12" } });
      vi.mocked(checkSpot).mockReturnValue(new Promise(() => {}));
      const events: AgentEvent[] = [];
      const result = runAgent(input, (event) => events.push(event));
      const expected = expect(result).rejects.toMatchObject({ body: { error: { code: "llm_unavailable" } } });
      await vi.advanceTimersByTimeAsync(25000); await expected;
      expect(text(events)).toBe(""); expect(events.some((event) => event.type === "done")).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("serializes the card contract in SSE", () => {
    expect(serializeEvent({ type: "card", card: { kind: "spot", result: spotResult } })).toBe(`event: card\ndata: ${JSON.stringify({ card: { kind: "spot", result: spotResult } })}\n\n`);
  });
});
