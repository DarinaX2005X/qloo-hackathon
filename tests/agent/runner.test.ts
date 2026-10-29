import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRequest, type AgentEvent, type EntityRef, type Neighborhood } from "@/shared/contracts";
import { runAgent, MAX_AGENT_STEPS, AGENT_TIMEOUT_MS } from "@/server/agent/runner";
import { FINAL_TIMEOUT_MS, NO_CHANGES_REPLY } from "@/server/agent/final";
import { chat, type ChatChunk } from "@/server/agent/llm";
import { rankNeighborhoods } from "@/server/engine";
import { searchEntities, searchPlaceTags } from "@/server/qloo";
import { POST } from "@/app/api/agent/route";
import { makePlan } from "@/server/agent/plan";

vi.mock("@/server/agent/llm", () => ({ chat: vi.fn() }));
vi.mock("@/server/qloo", () => ({ searchEntities: vi.fn(), searchPlaceTags: vi.fn() }));
vi.mock("@/server/engine", () => ({ rankNeighborhoods: vi.fn() }));
vi.mock("@/server/agent/plan", () => ({ makePlan: vi.fn(), executePlan: vi.fn() }));
const model = vi.mocked(chat);
const state = AgentRequest.shape.state.parse({ city: "Berlin", loves: [], refinements: [], discovery: 0.35, days: 3 });
const neighborhood: Neighborhood = { id: "n1", name: "Kreuzberg", center: [13.4, 52.5], rank: 1, score: 0.8, you: 0.8, drivers: [], matchedTags: [], vibe: "local", samplePlaces: [], cellIds: [] };

export async function* reply(chunks: ChatChunk[]): AsyncGenerator<ChatChunk> { for (const chunk of chunks) yield chunk; }
export async function* stalledReply(): AsyncGenerator<ChatChunk> { await new Promise<never>(() => {}); yield { type: "content", text: "late" }; }
export async function* delayedReply(chunks: ChatChunk[], delay: number): AsyncGenerator<ChatChunk> { await new Promise((resolve) => setTimeout(resolve, delay)); yield* reply(chunks); }
export function tool(name: string, args: unknown, id = name): ChatChunk { return { type: "tool_call", call: { id, type: "function", function: { name, arguments: JSON.stringify(args) } } }; }
export function queueReply(...chunks: ChatChunk[]): void { model.mockReturnValueOnce(reply(chunks)); }
export function request(message = "less touristy", overrides: Partial<AgentRequest> = {}): AgentRequest { return AgentRequest.parse({ state, message, history: [], ...overrides }); }
export function finalText(events: AgentEvent[]): string { return events.filter((e) => e.type === "delta").map((e) => e.text).join(""); }
export function progress(events: AgentEvent[]): AgentEvent[] { return events.filter((e) => e.type !== "trace" || e.tool !== "agent"); }

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(makePlan).mockResolvedValue(null);
  model.mockImplementation((options) => reply([{ type: "content", text: options.tools ? "Ready." : "I moved the dial toward locals. Kreuzberg is your best start." }]));
  vi.mocked(rankNeighborhoods).mockResolvedValue([neighborhood]);
  vi.mocked(searchEntities).mockResolvedValue([]); vi.mocked(searchPlaceTags).mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("fast agent", () => {
  it("emits immediate progress, ranks once after patches and streams final text without another tool turn", async () => {
    queueReply(tool("apply_changes", { ops: [{ op: "set_discovery", value: 0.8 }, { op: "set_days", days: 2 }] }));
    queueReply({ type: "content", text: "I moved the dial toward locals and set two days. " }, { type: "content", text: "Kreuzberg is your best start." });
    const events: AgentEvent[] = [];
    const pending = runAgent(request(), (e) => events.push(e));
    expect(events[0]).toEqual({ type: "trace", tool: "agent", summary: "Checking your preferences" });
    const result = await pending;
    expect(result).toMatchObject({ discovery: 0.8, days: 2 });
    expect(progress(events).map((e) => e.type)).toEqual(["trace", "patch", "trace", "delta", "delta", "done"]);
    expect(rankNeighborhoods).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ discovery: 0.8, days: 2 }));
    expect(model).toHaveBeenCalledTimes(2);
    const final = model.mock.calls[1][0];
    expect(final).toMatchObject({ stream: true, max_tokens: 120 }); expect(final.tools).toBeUndefined();
    expect(JSON.parse(String(final.messages[1].content)).facts.topNeighborhoods).toEqual(["Kreuzberg"]);
  });

  it("starts independent searches in parallel before any one resolves", async () => {
    let release!: (value: EntityRef[]) => void;
    const slow = new Promise<EntityRef[]>((resolve) => { release = resolve; });
    vi.mocked(searchEntities).mockReturnValue(slow);
    queueReply(tool("search_entities", { name: "A" }, "a"), tool("search_entities", { name: "B" }, "b"), tool("search_place_tags", { text: "wifi" }, "c"));
    const pending = runAgent(request(), () => {});
    await vi.waitFor(() => expect(searchEntities).toHaveBeenCalledTimes(2));
    expect(searchPlaceTags).toHaveBeenCalledTimes(1);
    release([]); await pending;
  });

  it("uses resolved genre representatives, discloses their purpose and drops a redundant unresolved genre", async () => {
    const entities: EntityRef[] = [{ id: "ben", name: "Ben Klock", domain: "artist" }, { id: "nina", name: "Nina Kraviz", domain: "artist" }, { id: "s", name: "Succession", domain: "tv_show" }];
    vi.mocked(searchEntities).mockImplementation(async (name) => entities.filter((entity) => entity.name === name));
    queueReply(...entities.map((entity, i) => tool("search_entities", { name: entity.name, domain: entity.domain, ...(i < 2 ? { reference_for: "techno" } : {}) }, String(i))));
    queueReply(tool("apply_changes", { ops: [{ op: "set_companion", loves: [
      { query: "techno", chosen: null, candidates: [], weight: 1 },
      ...entities.map((entity) => ({ query: entity.name, chosen: entity, candidates: [], weight: 1 })),
    ] }] }));
    queueReply({ type: "content", text: "For techno I used Ben Klock and Nina Kraviz as reference points; I also added Succession. " }, { type: "content", text: "Kreuzberg is your shared best start." });
    const events: AgentEvent[] = [];
    const result = await runAgent(request("add my partner: techno and Succession"), (e) => events.push(e));
    expect(result.companion?.loves).toHaveLength(3); expect(result.companion?.loves.every((love) => love.chosen)).toBe(true);
    const facts = JSON.parse(String(model.mock.calls.at(-1)![0].messages[1].content)).facts;
    expect(facts.references).toEqual([{ taste: "techno", names: ["Ben Klock", "Nina Kraviz"] }]);
    expect(finalText(events)).toContain("reference points"); expect(model).toHaveBeenCalledTimes(3);
  });

  it("reuses text delivered with the successful patch instead of calling the model again", async () => {
    queueReply({ type: "content", text: "I set your trip to two days." }, tool("apply_changes", { ops: [{ op: "set_days", days: 2 }] }));
    const events: AgentEvent[] = [];
    await runAgent(request("only two days"), (e) => events.push(e));
    expect(model).toHaveBeenCalledTimes(1); expect(finalText(events)).toBe("I set your trip to two days.");
  });

  it("emits each final delta before the stream finishes", async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => { finish = resolve; });
    async function* streaming(): AsyncGenerator<ChatChunk> { yield { type: "content", text: "I set two days." }; await waiting; }
    queueReply(tool("apply_changes", { ops: [{ op: "set_days", days: 2 }] })); model.mockReturnValueOnce(streaming());
    const events: AgentEvent[] = [];
    const pending = runAgent(request(), (e) => events.push(e));
    await vi.waitFor(() => expect(finalText(events)).toBe("I set two days."));
    expect(events.some((e) => e.type === "done")).toBe(false); finish(); await pending;
  });

  it("returns invalid patches privately without trace errors or partial changes", async () => {
    queueReply(tool("apply_changes", { ops: [{ op: "set_days", days: 2 }, { op: "set_discovery", value: 5 }] }));
    const events: AgentEvent[] = [];
    expect(await runAgent(request(), (e) => events.push(e))).toEqual(state);
    expect(progress(events).map((e) => e.type)).toEqual(["delta", "done"]);
    expect(model.mock.calls[1][0].messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("bad_input") });
    expect(finalText(events)).toBe(NO_CHANGES_REPLY);
  });

  it("restores authoritative metadata while allowing UUID casing", async () => {
    const entity: EntityRef = { id: "65eac55f-6fdc-452d-a633-a9e9f2bbd45e", name: "Radiohead", domain: "artist", subtitle: "Authoritative", popularity: 0.6 };
    vi.mocked(searchEntities).mockResolvedValue([entity]);
    queueReply(tool("search_entities", { name: "Radiohead" }));
    queueReply(tool("apply_changes", { ops: [{ op: "add_love", love: { query: "Radiohead", chosen: { id: entity.id.toUpperCase(), name: "RADIOHEAD", domain: "artist", popularity: 1 }, candidates: [], weight: 1 } }] }));
    expect((await runAgent(request("add Radiohead"), () => {})).loves[0].chosen).toEqual(entity);
  });

  it("bounds tool executions and honestly reports no changes", async () => {
    queueReply(...Array.from({ length: 12 }, (_, i) => tool("search_entities", { name: `taste ${i}` }, String(i))));
    const events: AgentEvent[] = [];
    await runAgent(request(), (e) => events.push(e));
    expect(searchEntities).toHaveBeenCalledTimes(MAX_AGENT_STEPS); expect(MAX_AGENT_STEPS).toBe(8);
    expect(finalText(events)).toBe(NO_CHANGES_REPLY); expect(model).toHaveBeenCalledTimes(1);
  });

  it("keeps the whole request including final generation within 25 seconds", async () => {
    vi.useFakeTimers();
    model.mockReturnValueOnce(delayedReply([tool("apply_changes", { ops: [{ op: "set_days", days: 2 }] })], 24_000));
    model.mockReturnValueOnce(stalledReply());
    const events: AgentEvent[] = [];
    const pending = runAgent(request(), (e) => events.push(e));
    await vi.advanceTimersByTimeAsync(AGENT_TIMEOUT_MS);
    expect((await pending).days).toBe(2); expect(AGENT_TIMEOUT_MS).toBe(25_000);
    expect(finalText(events)).toBe("I set the trip to 2 days."); expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("bounds a stalled final response and uses a template with changes and ranking", async () => {
    vi.useFakeTimers();
    queueReply(tool("apply_changes", { ops: [{ op: "set_discovery", value: 0.7 }] })); model.mockReturnValueOnce(stalledReply());
    const events: AgentEvent[] = [];
    const pending = runAgent(request(), (e) => events.push(e));
    await vi.advanceTimersByTimeAsync(FINAL_TIMEOUT_MS); await pending;
    expect(finalText(events)).toBe("I moved the crowd dial toward locals. Your best start is now Kreuzberg.");
  });

  it("continues a matching streamed prefix without duplicating the confirmation", async () => {
    vi.useFakeTimers();
    async function* partial(): AsyncGenerator<ChatChunk> { yield { type: "content", text: "I moved" }; await new Promise<never>(() => {}); }
    queueReply(tool("apply_changes", { ops: [{ op: "set_discovery", value: 0.7 }] })); model.mockReturnValueOnce(partial());
    const events: AgentEvent[] = []; const pending = runAgent(request(), (event) => events.push(event));
    await vi.advanceTimersByTimeAsync(FINAL_TIMEOUT_MS); await pending;
    expect(finalText(events)).toBe("I moved the crowd dial toward locals. Your best start is now Kreuzberg.");
  });

  it("finishes honestly after a timeout without any patches", async () => {
    vi.useFakeTimers(); model.mockReturnValueOnce(stalledReply());
    const events: AgentEvent[] = []; const pending = runAgent(request(), (e) => events.push(e));
    await vi.advanceTimersByTimeAsync(AGENT_TIMEOUT_MS);
    expect(await pending).toEqual(state); expect(finalText(events)).toBe(NO_CHANGES_REPLY); expect(model).toHaveBeenCalledTimes(1);
  });

  it("handles a failed ranking without leaking provider details", async () => {
    vi.mocked(rankNeighborhoods).mockRejectedValue(new Error("private provider details"));
    queueReply(tool("apply_changes", { ops: [{ op: "set_discovery", value: 0.7 }] })); model.mockImplementationOnce(() => { throw new Error("final provider failed"); });
    const events: AgentEvent[] = []; await runAgent(request(), (e) => events.push(e));
    expect(finalText(events)).toContain("moved the crowd dial toward locals"); expect(finalText(events)).toContain("ranking is not available");
    expect(JSON.stringify(events)).not.toContain("private provider details");
  });

  it("caps refinements at two even when patch batches attempt three", async () => {
    const tags = ["Laptop friendly", "Free Wifi", "Cafe"].map((name, i) => ({ id: `tag-${i}`, name, kind: "amenity" }));
    vi.mocked(searchPlaceTags).mockResolvedValue(tags);
    queueReply(tool("search_place_tags", { text: "wifi" }));
    queueReply(tool("apply_changes", { ops: tags.map((tag) => ({ op: "add_refinement", tag })) }));
    queueReply(tool("apply_changes", { ops: tags.slice(0, 2).map((tag) => ({ op: "add_refinement", tag })) }));
    const events: AgentEvent[] = []; const result = await runAgent(request("I work from cafés"), (e) => events.push(e));
    expect(result.refinements).toEqual(tags.slice(0, 2)); expect(events.filter((e) => e.type === "patch")).toHaveLength(1);
    expect(events.filter((e) => e.type === "trace" && e.tool === "apply_changes")).toHaveLength(1);
  });

  it("does not make a final call after a disconnect", async () => {
    const abort = new AbortController(); model.mockReturnValueOnce(stalledReply());
    const pending = runAgent(request(), () => {}, abort.signal); abort.abort();
    await expect(pending).rejects.toMatchObject({ body: { error: { code: "llm_unavailable" } } }); expect(model).toHaveBeenCalledTimes(1);
  });
});

describe("agent route", () => {
  it("returns a 400 ApiError before opening SSE for invalid input", async () => {
    const response = await POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify({ ...request(), message: " " }) }));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: { code: "bad_input" } }); expect(model).not.toHaveBeenCalled();
  });
  it("serializes patch before streamed deltas and done", async () => {
    queueReply(tool("apply_changes", { ops: [{ op: "set_days", days: 2 }] })); queueReply({ type: "content", text: "Two days.\n" }, { type: "content", text: "Ready." });
    const response = await POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify(request("only two days")) }));
    const body = await response.text(); expect(body.indexOf("event: patch")).toBeLessThan(body.indexOf("event: delta"));
    expect(body).toContain('data: {"text":"Two days.\\n"}'); expect(body).toContain("event: done\ndata: {}");
  });
  it("emits a structured model error without a false done", async () => {
    model.mockImplementationOnce(() => { throw new Error("private provider details"); });
    const response = await POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify(request()) }));
    const body = await response.text(); expect(body).toContain('event: error\ndata: {"error":{"code":"llm_unavailable"'); expect(body).not.toContain("private provider details"); expect(body).not.toContain("event: done");
  });
});
