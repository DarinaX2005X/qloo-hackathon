import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRequest, type AgentEvent, type EntityRef, type Neighborhood, type TasteField } from "@/shared/contracts";
import { runAgent, MAX_AGENT_STEPS } from "@/server/agent/runner";
import { chat, type ChatChunk } from "@/server/agent/llm";
import { buildField, rankNeighborhoods } from "@/server/engine";
import { searchEntities, searchPlaceTags } from "@/server/qloo";
import { POST } from "@/app/api/agent/route";

vi.mock("@/server/agent/llm", () => ({ chat: vi.fn() }));
vi.mock("@/server/qloo", () => ({ searchEntities: vi.fn(), searchPlaceTags: vi.fn() }));
vi.mock("@/server/engine", () => ({ buildField: vi.fn(), rankNeighborhoods: vi.fn() }));

const model = vi.mocked(chat);
const state = { city: "Berlin", loves: [], refinements: [], discovery: 0.35, days: 3 as const };
const neighborhood: Neighborhood = { id: "n1", name: "Kreuzberg", center: [13.4, 52.5], rank: 1, score: 0.8, you: 0.8, drivers: [{ domain: "artist", share: 1, love: "Radiohead" }], matchedTags: [], vibe: "local", samplePlaces: ["Returned Cafe"], cellIds: ["u33dbf"] };
const field: TasteField = { city: "Berlin", center: [13.4, 52.5], bbox: [13, 52, 14, 53], cells: [], sparse: true, signalsWithoutGeo: [] };

export async function* reply(chunks: ChatChunk[]): AsyncGenerator<ChatChunk> {
  for (const chunk of chunks) yield chunk;
}

export async function* stalledReply(): AsyncGenerator<ChatChunk> {
  await new Promise<never>(() => {});
  yield { type: "content", text: "late" };
}

export function tool(name: string, args: unknown, id = name): ChatChunk {
  return { type: "tool_call", call: { id, type: "function", function: { name, arguments: JSON.stringify(args) } } };
}

export function queueReply(...chunks: ChatChunk[]): void { model.mockReturnValueOnce(reply(chunks)); }

export function request(message = "less touristy", overrides: Partial<AgentRequest> = {}): AgentRequest {
  return AgentRequest.parse({ state, message, history: [], ...overrides });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(buildField).mockResolvedValue(field);
  vi.mocked(rankNeighborhoods).mockResolvedValue([neighborhood]);
  vi.mocked(searchEntities).mockResolvedValue([]);
  vi.mocked(searchPlaceTags).mockResolvedValue([]);
});

describe("agent loop", () => {
  it("emits trace, patch, ranking trace, text and done in order with updated ranking state", async () => {
    queueReply({ type: "content", text: "discard pre-tool chatter" }, tool("apply_changes", { ops: [{ op: "set_discovery", value: 0.8 }, { op: "set_days", days: 2 }] }));
    queueReply(tool("get_ranking", {}));
    queueReply({ type: "content", text: "Kreuzberg fits. " }, { type: "content", text: "Two days are set." });
    const events: AgentEvent[] = [];
    const result = await runAgent(request(), (event) => events.push(event));
    expect(events.map((e) => e.type)).toEqual(["trace", "patch", "trace", "delta", "delta", "done"]);
    expect(result).toMatchObject({ discovery: 0.8, days: 2 });
    expect(state.days).toBe(3);
    expect(buildField).toHaveBeenCalledWith(expect.objectContaining({ discovery: 0.8, days: 2 }));
    expect(rankNeighborhoods).toHaveBeenCalledWith(expect.objectContaining({ discovery: 0.8 }), field);
  });

  it("resolves partner entities before applying companion loves", async () => {
    const succession: EntityRef = { id: "succession", name: "Succession", domain: "tv_show" };
    vi.mocked(searchEntities).mockImplementation(async (q) => q === "Succession" ? [succession] : []);
    queueReply(tool("search_entities", { name: "techno" }, "a"), tool("search_entities", { name: "Succession", domain: "tv_show" }, "b"));
    queueReply(tool("apply_changes", { ops: [{ op: "set_companion", loves: [
      { query: "techno", chosen: null, candidates: [], weight: 1 },
      { query: "Succession", chosen: succession, candidates: [succession], weight: 1 },
    ] }] }));
    queueReply({ type: "content", text: "Added your partner’s tastes." });
    const events: AgentEvent[] = [];
    const result = await runAgent(request("add my partner: techno, Succession"), (event) => events.push(event));
    expect(result.companion?.loves).toHaveLength(2);
    expect(events.find((e) => e.type === "trace")).toMatchObject({ summary: "Looked up “techno” → no matches" });
    expect(events.filter((e) => e.type === "patch")).toHaveLength(1);
  });

  it("adds a returned work-from-cafes refinement and explains returned evidence", async () => {
    const tag = { id: "urn:tag:amenity:laptop", name: "Laptop friendly", kind: "amenity" };
    vi.mocked(searchPlaceTags).mockResolvedValue([tag]);
    queueReply(tool("search_place_tags", { text: "laptop friendly" }));
    queueReply(tool("apply_changes", { ops: [{ op: "add_refinement", tag }] }));
    queueReply(tool("explain_neighborhood", { id: "n1" }));
    queueReply({ type: "content", text: "Kreuzberg has the strongest fit." });
    const result = await runAgent(request("I work from cafés"), () => {});
    expect(result.refinements).toEqual([tag]);
    expect(rankNeighborhoods).toHaveBeenCalledTimes(1);
  });

  it("rejects the whole invalid patch batch without partial mutation and allows recovery", async () => {
    queueReply(tool("apply_changes", { ops: [{ op: "set_days", days: 2 }, { op: "set_discovery", value: 5 }] }));
    queueReply({ type: "content", text: "I couldn’t apply those changes." });
    const events: AgentEvent[] = [];
    const result = await runAgent(request(), (event) => events.push(event));
    expect(result).toEqual(state);
    expect(events.map((e) => e.type)).toEqual(["trace", "delta", "done"]);
    const lastOptions = model.mock.calls[1][0];
    expect(lastOptions.messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("bad_input") });
  });

  it("restores lookup metadata when the model omits or changes optional fields", async () => {
    const entity: EntityRef = { id: "r", name: "Radiohead", domain: "artist", subtitle: "Lookup description", popularity: 0.6 };
    vi.mocked(searchEntities).mockResolvedValue([entity]);
    queueReply(tool("search_entities", { name: "Radiohead" }));
    queueReply(tool("apply_changes", { ops: [{ op: "add_love", love: {
      query: "Radiohead", chosen: { id: "r", name: "Radiohead", domain: "artist", popularity: 1 },
      candidates: [{ id: "r", name: "Radiohead", domain: "artist" }], weight: 1,
    } }] }));
    queueReply({ type: "content", text: "Added Radiohead." });
    const events: AgentEvent[] = [];
    const result = await runAgent(request("add Radiohead"), (event) => events.push(event));
    expect(result.loves[0].chosen).toEqual(entity);
    expect(result.loves[0].candidates).toEqual([entity]);
    expect(events.find((e) => e.type === "patch")).toMatchObject({ ops: [{ love: { chosen: entity } }] });
  });

  it("rejects invented ids and metadata, unknown tools and malformed arguments", async () => {
    queueReply(tool("apply_changes", { ops: [{ op: "add_refinement", tag: { id: "fake", name: "Cozy", kind: "ambience" } }] }));
    queueReply(tool("apply_changes", { ops: [{ op: "add_love", love: { query: "Fake", chosen: { id: "fake", name: "Fake", domain: "artist" }, candidates: [], weight: 1 } }] }));
    queueReply(tool("invented", {}));
    queueReply({ type: "tool_call", call: { id: "bad", type: "function", function: { name: "apply_changes", arguments: "{" } } });
    queueReply({ type: "content", text: "No changes were applied." });
    const events: AgentEvent[] = [];
    expect(await runAgent(request(), (e) => events.push(e))).toEqual(state);
    expect(events.filter((e) => e.type === "patch")).toHaveLength(0);
    expect(events.filter((e) => e.type === "trace")).toHaveLength(4);
  });

  it("executes no more than six tools even in a single oversized batch", async () => {
    queueReply(...Array.from({ length: 10 }, (_, i) => tool("search_entities", { name: `taste ${i}` }, String(i))));
    const events: AgentEvent[] = [];
    await runAgent(request(), (e) => events.push(e));
    expect(searchEntities).toHaveBeenCalledTimes(MAX_AGENT_STEPS);
    expect(events.filter((e) => e.type === "trace")).toHaveLength(MAX_AGENT_STEPS);
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("bounds looping model turns and invalidates ranking after changes", async () => {
    queueReply(tool("get_ranking", {}));
    queueReply(tool("get_ranking", {}));
    queueReply(tool("apply_changes", { ops: [{ op: "set_discovery", value: 0.9 }] }));
    queueReply(tool("get_ranking", {}));
    queueReply(tool("get_ranking", {}));
    queueReply(tool("get_ranking", {}));
    await runAgent(request(), () => {});
    expect(model).toHaveBeenCalledTimes(6);
    expect(buildField).toHaveBeenCalledTimes(2);
  });

  it("bounds a stalled model and does not execute pending changes after cancellation", async () => {
    const abort = new AbortController();
    model.mockImplementation(() => stalledReply());
    const events: AgentEvent[] = [];
    const pending = runAgent(request(), (e) => events.push(e), abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ body: { error: { code: "llm_unavailable" } } });
    expect(events).toEqual([]);
  });
});

describe("agent route", () => {
  it("returns a 400 ApiError before opening SSE for an invalid request", async () => {
    const response = await POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify({ ...request(), message: " " }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "bad_input" } });
    expect(model).not.toHaveBeenCalled();
  });

  it("serializes named SSE events with patches before final text", async () => {
    queueReply(tool("apply_changes", { ops: [{ op: "set_days", days: 2 }] }));
    queueReply({ type: "content", text: "Two days.\nReady." });
    const response = await POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify(request("only two days")) }));
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body.indexOf("event: patch")).toBeLessThan(body.indexOf("event: delta"));
    expect(body).toContain('data: {"text":"Two days.\\nReady."}');
    expect(body).toContain("event: done\ndata: {}");
  });

  it("emits a structured runtime error without a false done event", async () => {
    queueReply(tool("get_ranking", {}));
    vi.mocked(buildField).mockRejectedValue(new Error("private provider details"));
    const response = await POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify(request()) }));
    const body = await response.text();
    expect(body).toContain('event: error\ndata: {"error":{"code":"qloo_unavailable"');
    expect(body).not.toContain("private provider details");
    expect(body).not.toContain("event: done");
  });
});
