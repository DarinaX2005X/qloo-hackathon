import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRequest, type AgentEvent, type EntityRef, type Neighborhood, type TasteField } from "@/shared/contracts";
import { runAgent, MAX_AGENT_STEPS, AGENT_TIMEOUT_MS } from "@/server/agent/runner";
import { FINAL_TIMEOUT_MS, NO_CHANGES_REPLY } from "@/server/agent/final";
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

export async function* reply(chunks: ChatChunk[]): AsyncGenerator<ChatChunk> { for (const chunk of chunks) yield chunk; }
export async function* stalledReply(): AsyncGenerator<ChatChunk> { await new Promise<never>(() => {}); yield { type: "content", text: "late" }; }
export function tool(name: string, args: unknown, id = name): ChatChunk {
  return { type: "tool_call", call: { id, type: "function", function: { name, arguments: JSON.stringify(args) } } };
}
export function queueReply(...chunks: ChatChunk[]): void { model.mockReturnValueOnce(reply(chunks)); }
export function queueFinal(text: string): void { model.mockReturnValueOnce(Promise.resolve({ content: text, tool_calls: [] })); }
export function request(message = "less touristy", overrides: Partial<AgentRequest> = {}): AgentRequest { return AgentRequest.parse({ state, message, history: [], ...overrides }); }
export function finalText(events: AgentEvent[]): string { return events.filter((e) => e.type === "delta").map((e) => e.text).join(""); }

beforeEach(() => {
  vi.resetAllMocks();
  model.mockImplementation((options) => options.stream ? reply([{ type: "content", text: "Ready." }]) : Promise.resolve({ content: "Confirmed changes. Kreuzberg is the best start.", tool_calls: [] }));
  vi.mocked(buildField).mockResolvedValue(field);
  vi.mocked(rankNeighborhoods).mockResolvedValue([neighborhood]);
  vi.mocked(searchEntities).mockResolvedValue([]);
  vi.mocked(searchPlaceTags).mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("agent loop", () => {
  it("automatically ranks updated state and sends confirmed facts to the final model without tools", async () => {
    queueReply({ type: "content", text: "discard chatter" }, tool("apply_changes", { ops: [{ op: "set_discovery", value: 0.8 }, { op: "set_days", days: 2 }] }));
    queueReply({ type: "content", text: "discard generic draft" });
    queueFinal("I moved the crowd dial toward locals and set two days. Kreuzberg is your best start.");
    const events: AgentEvent[] = [];
    const result = await runAgent(request(), (event) => events.push(event));
    expect(events.map((e) => e.type)).toEqual(["trace", "patch", "trace", "delta", "done"]);
    expect(result).toMatchObject({ discovery: 0.8, days: 2 });
    expect(state.days).toBe(3);
    expect(buildField).toHaveBeenCalledWith(expect.objectContaining({ discovery: 0.8, days: 2 }));
    expect(rankNeighborhoods).toHaveBeenCalledWith(expect.objectContaining({ discovery: 0.8 }), field);
    const options = model.mock.calls.at(-1)![0];
    expect(options.tools).toBeUndefined();
    expect(options.stream).toBeUndefined();
    expect(JSON.parse(String(options.messages[1].content)).facts).toMatchObject({ topNeighborhood: "Kreuzberg", changes: ["Moved the crowd dial toward locals", "Set the trip to 2 days"] });
    expect(finalText(events)).not.toContain("draft");
  });

  it("resolves partner entities and preserves an unresolved genre without inventing a match", async () => {
    const succession: EntityRef = { id: "succession", name: "Succession", domain: "tv_show" };
    vi.mocked(searchEntities).mockImplementation(async (q) => q === "Succession" ? [succession] : []);
    queueReply(tool("search_entities", { name: "techno" }, "a"), tool("search_entities", { name: "Succession", domain: "tv_show" }, "b"));
    queueReply(tool("apply_changes", { ops: [{ op: "set_companion", loves: [
      { query: "techno", chosen: null, candidates: [], weight: 1 },
      { query: "Succession", chosen: succession, candidates: [succession], weight: 1 },
    ] }] }));
    const result = await runAgent(request("add my partner: techno, Succession"), () => {});
    expect(result.companion?.loves).toHaveLength(2);
    expect(buildField).toHaveBeenCalledWith(expect.objectContaining({ companion: { loves: result.companion!.loves } }));
    const facts = JSON.parse(String(model.mock.calls.at(-1)![0].messages[1].content)).facts;
    expect(facts).toMatchObject({ shared: true, unresolvedPartnerTastes: ["techno"], topNeighborhood: "Kreuzberg" });
  });

  it("hides tool validation errors from trace while returning them privately to the model", async () => {
    queueReply(tool("apply_changes", { ops: [{ op: "set_days", days: 2 }, { op: "set_discovery", value: 5 }] }));
    queueReply({ type: "content", text: "I couldn’t apply those changes. Please rephrase your request." });
    const events: AgentEvent[] = [];
    expect(await runAgent(request(), (e) => events.push(e))).toEqual(state);
    expect(events.map((e) => e.type)).toEqual(["delta", "done"]);
    expect(model.mock.calls[1][0].messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("bad_input") });
  });

  it("rejects invented ids, unknown tools and malformed arguments without user-visible errors", async () => {
    queueReply(tool("apply_changes", { ops: [{ op: "add_refinement", tag: { id: "fake", name: "Cozy", kind: "ambience" } }] }));
    queueReply(tool("apply_changes", { ops: [{ op: "add_love", love: { query: "Fake", chosen: { id: "fake", name: "Fake", domain: "artist" }, candidates: [], weight: 1 } }] }));
    queueReply(tool("invented", {}));
    queueReply({ type: "tool_call", call: { id: "bad", type: "function", function: { name: "apply_changes", arguments: "{" } } });
    const events: AgentEvent[] = [];
    expect(await runAgent(request(), (e) => events.push(e))).toEqual(state);
    expect(events.filter((e) => e.type === "patch" || e.type === "trace")).toEqual([]);
    expect(JSON.stringify(events)).not.toContain("preserve");
  });

  it("restores authoritative entity metadata and accepts UUID casing without changing identity", async () => {
    const entity: EntityRef = { id: "65eac55f-6fdc-452d-a633-a9e9f2bbd45e", name: "Radiohead", domain: "artist", subtitle: "Lookup description", popularity: 0.6 };
    vi.mocked(searchEntities).mockResolvedValue([entity]);
    queueReply(tool("search_entities", { name: "Radiohead" }));
    queueReply(tool("apply_changes", { ops: [{ op: "add_love", love: {
      query: "Radiohead", chosen: { id: entity.id.toUpperCase(), name: "RADIOHEAD", domain: "artist", popularity: 1 }, candidates: [], weight: 1,
    } }] }));
    expect((await runAgent(request("add Radiohead"), () => {})).loves[0].chosen).toEqual(entity);
  });

  it("limits model tool executions to eight and honestly reports no changes", async () => {
    queueReply(...Array.from({ length: 12 }, (_, i) => tool("search_entities", { name: `taste ${i}` }, String(i))));
    const events: AgentEvent[] = [];
    await runAgent(request(), (e) => events.push(e));
    expect(searchEntities).toHaveBeenCalledTimes(8);
    expect(MAX_AGENT_STEPS).toBe(8);
    expect(finalText(events)).toBe(NO_CHANGES_REPLY);
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("makes exactly one final no-tools call when the budget ends after an applied change", async () => {
    queueReply(tool("apply_changes", { ops: [{ op: "set_days", days: 2 }] }), ...Array.from({ length: 7 }, (_, i) => tool("search_entities", { name: `taste ${i}` }, String(i))));
    queueFinal("I set your trip to two days.");
    const events: AgentEvent[] = [];
    await runAgent(request(), (e) => events.push(e));
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].tools).toBeUndefined();
    expect(finalText(events)).toBe("I set your trip to two days.");
    expect(finalText(events)).not.toMatch(/limit|continue/i);
  });

  it("gives a fresh deadline to the final call after a work timeout and keeps applied patches", async () => {
    vi.useFakeTimers();
    queueReply(tool("apply_changes", { ops: [{ op: "set_days", days: 2 }] }));
    model.mockReturnValueOnce(stalledReply());
    queueFinal("I set your trip to two days.");
    const events: AgentEvent[] = [];
    const pending = runAgent(request(), (e) => events.push(e));
    await vi.advanceTimersByTimeAsync(AGENT_TIMEOUT_MS);
    expect((await pending).days).toBe(2);
    expect(finalText(events)).toBe("I set your trip to two days.");
    expect(model.mock.calls.at(-1)![0].signal?.aborted).toBe(false);
  });

  it("finishes honestly after a timeout without any applied changes", async () => {
    vi.useFakeTimers();
    model.mockReturnValueOnce(stalledReply());
    const events: AgentEvent[] = [];
    const pending = runAgent(request(), (e) => events.push(e));
    await vi.advanceTimersByTimeAsync(AGENT_TIMEOUT_MS);
    expect(await pending).toEqual(state);
    expect(finalText(events)).toBe(NO_CHANGES_REPLY);
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("bounds final generation and falls back to concrete confirmed changes", async () => {
    vi.useFakeTimers();
    queueReply(tool("apply_changes", { ops: [{ op: "set_days", days: 2 }] }));
    queueReply({ type: "content", text: "Ready" });
    model.mockReturnValueOnce(new Promise(() => {}));
    const events: AgentEvent[] = [];
    const pending = runAgent(request(), (e) => events.push(e));
    await vi.advanceTimersByTimeAsync(FINAL_TIMEOUT_MS);
    await pending;
    expect(finalText(events)).toBe("Set the trip to 2 days.");
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("replaces a generic or forbidden final response with the actual changes and current top", async () => {
    queueReply(tool("apply_changes", { ops: [{ op: "set_discovery", value: 0.7 }] }));
    queueReply({ type: "content", text: "Ready" });
    queueFinal("Your profile has been updated. I’ve reached the limit for this request; send another message to continue.");
    const events: AgentEvent[] = [];
    await runAgent(request(), (event) => events.push(event));
    expect(finalText(events)).toBe("Moved the crowd dial toward locals. Your best start is now Kreuzberg.");
  });

  it("keeps a current ranking when only the trip length changes", async () => {
    queueReply(tool("get_ranking", {}));
    queueReply(tool("apply_changes", { ops: [{ op: "set_days", days: 2 }] }));
    const events: AgentEvent[] = [];
    await runAgent(request("only two days"), (event) => events.push(event));
    expect(buildField).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(model.mock.calls.at(-1)![0].messages[1].content)).facts.topNeighborhood).toBe("Kreuzberg");
  });

  it("returns external tool failures to the model without putting them in trace", async () => {
    queueReply(tool("get_ranking", {}));
    vi.mocked(buildField).mockRejectedValue(new Error("private provider details"));
    const events: AgentEvent[] = [];
    await runAgent(request("show my ranking"), (event) => events.push(event));
    expect(model.mock.calls[1][0].messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("qloo_unavailable") });
    expect(events.some((event) => event.type === "trace")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("private provider details");
  });

  it("uses the latest ranking after multiple changes and never an earlier top", async () => {
    vi.mocked(rankNeighborhoods).mockResolvedValueOnce([neighborhood]).mockResolvedValueOnce([{ ...neighborhood, name: "Mitte" }]);
    queueReply(tool("apply_changes", { ops: [{ op: "set_discovery", value: 0.8 }] }));
    queueReply(tool("apply_changes", { ops: [{ op: "set_city", city: "Lisbon" }] }));
    queueReply({ type: "content", text: "Old draft mentions Kreuzberg" });
    queueFinal("I moved the dial toward locals and changed the city to Lisbon. Mitte is now the best start.");
    const events: AgentEvent[] = [];
    await runAgent(request(), (e) => events.push(e));
    expect(buildField).toHaveBeenCalledTimes(2);
    expect(finalText(events)).toContain("Mitte");
    expect(finalText(events)).not.toContain("Kreuzberg");
  });

  it("caps refinements at two across separate apply_changes calls and returns errors only to the model", async () => {
    const tags = ["Laptop friendly", "Free Wifi", "Cafe"].map((name, i) => ({ id: `tag-${i}`, name, kind: "amenity" }));
    vi.mocked(searchPlaceTags).mockResolvedValue(tags);
    queueReply(tool("search_place_tags", { text: "wifi" }));
    queueReply(tool("apply_changes", { ops: tags.slice(0, 2).map((tag) => ({ op: "add_refinement", tag })) }));
    queueReply(tool("apply_changes", { ops: [{ op: "add_refinement", tag: tags[2] }] }));
    const events: AgentEvent[] = [];
    const result = await runAgent(request("I work from cafés"), (e) => events.push(e));
    expect(result.refinements).toEqual(tags.slice(0, 2));
    expect(events.filter((e) => e.type === "patch")).toHaveLength(1);
    expect(events.filter((e) => e.type === "trace" && e.tool === "apply_changes")).toHaveLength(1);
    expect(JSON.stringify(model.mock.calls[3][0].messages)).toContain("at most two");
  });

  it("reports a failed refreshed ranking truthfully while keeping the confirmed change", async () => {
    vi.mocked(buildField).mockRejectedValue(new Error("private provider details"));
    queueReply(tool("apply_changes", { ops: [{ op: "set_discovery", value: 0.8 }] }));
    queueReply({ type: "content", text: "Ready" });
    model.mockRejectedValueOnce(new Error("model unavailable"));
    const events: AgentEvent[] = [];
    await runAgent(request(), (e) => events.push(e));
    expect(finalText(events)).toContain("Moved the crowd dial toward locals");
    expect(finalText(events)).toContain("ranking is not available");
    expect(JSON.stringify(events)).not.toContain("private provider details");
    expect(events.filter((e) => e.type === "trace")).toHaveLength(1);
  });

  it("does not make a final call after the user disconnects", async () => {
    const abort = new AbortController();
    model.mockReturnValueOnce(stalledReply());
    const pending = runAgent(request(), () => {}, abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ body: { error: { code: "llm_unavailable" } } });
    expect(model).toHaveBeenCalledTimes(1);
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
    queueReply({ type: "content", text: "Ready" });
    queueFinal("I set two days.\nReady.");
    const response = await POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify(request("only two days")) }));
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body.indexOf("event: patch")).toBeLessThan(body.indexOf("event: delta"));
    expect(body).toContain('data: {"text":"I set two days.\\nReady."}');
    expect(body).toContain("event: done\ndata: {}");
  });

  it("emits a structured model error without a false done event", async () => {
    model.mockImplementationOnce(() => { throw new Error("private provider details"); });
    const response = await POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify(request()) }));
    const body = await response.text();
    expect(body).toContain('event: error\ndata: {"error":{"code":"llm_unavailable"');
    expect(body).not.toContain("private provider details");
    expect(body).not.toContain("event: done");
  });
});
