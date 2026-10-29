import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { extractTastes } from "@/server/agent/intake";
import { runAgent } from "@/server/agent/runner";
import { buildField, rankNeighborhoods } from "@/server/engine";
import { AgentRequest, type AgentEvent } from "@/shared/contracts";
import * as llm from "@/server/agent/llm";

const fixtures = join(process.cwd(), "tests/agent/__fixtures__");
const screenshot = join(fixtures, "visible-books.png");

export async function saveLiveFixture(name: string, value: unknown): Promise<void> {
  await mkdir(fixtures, { recursive: true });
  await writeFile(join(fixtures, name), JSON.stringify(value, null, 2));
}

export async function* captureToolCalls(stream: AsyncGenerator<llm.ChatChunk>, calls: llm.ToolCall[]): AsyncGenerator<llm.ChatChunk> {
  for await (const chunk of stream) {
    if (chunk.type === "tool_call") calls.push(chunk.call);
    yield chunk;
  }
}

describe.skipIf(process.env.QLOO_LIVE !== "1")("live agent and intake", () => {
  beforeAll(() => { process.loadEnvFile?.(".env.local"); });

  it("extracts and resolves mixed tastes from text", async () => {
    const result = await extractTastes({ text: "I love Radiohead, Fleabag and natural wine bars, moving to Berlin" });
    await saveLiveFixture("text-intake.json", result);
    expect(result.city).toBe("Berlin");
    expect(result.loves).toHaveLength(3);
    expect(result.loves.find((l) => l.query.toLowerCase() === "radiohead")?.chosen?.domain).toBe("artist");
    console.info("Live intake:", { city: result.city, items: result.loves.length, resolved: result.loves.filter((l) => l.chosen).length });
  }, 45_000);

  it.skipIf(!existsSync(screenshot))("reads only visible book titles from an image", async () => {
    const image = `data:image/png;base64,${(await readFile(screenshot)).toString("base64")}`;
    const result = await extractTastes({ image });
    await saveLiveFixture("image-intake.json", result);
    expect(result.city).toBeUndefined();
    expect(result.loves.map((l) => l.query.toLowerCase()).sort()).toEqual(["dune", "the hobbit"]);
    console.info("Live image intake:", { items: result.loves.length, names: result.loves.map((l) => l.query) });
  }, 45_000);

  it("changes days and discovery through apply_changes", async () => {
    const events: AgentEvent[] = [];
    const result = await runAgent(AgentRequest.parse({
      state: { city: "Berlin", loves: [], days: 3 },
      message: "Only two days, and make it less touristy. Just update the settings; no ranking needed.", history: [],
    }), (event) => events.push(event));
    await saveLiveFixture("agent-settings.json", { result, events });
    expect(result.days).toBe(2);
    expect(result.discovery).toBeGreaterThanOrEqual(0.7);
    expect(events.findIndex((e) => e.type === "patch")).toBeLessThan(events.findIndex((e) => e.type === "delta"));
    console.info("Live settings:", { days: result.days, discovery: result.discovery, tools: events.filter((e) => e.type === "trace").length });
  }, 60_000);

  it("looks up partner tastes and cafe tags before applying changes", async () => {
    const events: AgentEvent[] = [];
    const calls: llm.ToolCall[] = [];
    const realChat = llm.chat;
    const spy = vi.spyOn(llm, "chat").mockImplementation((options: llm.ChatOptions) => {
      const result = realChat(options);
      return Symbol.asyncIterator in result ? captureToolCalls(result, calls) : result;
    });
    let result;
    try { result = await runAgent(AgentRequest.parse({
      state: { city: "Berlin", loves: [] },
      message: "Add my partner: techno, Succession. I work from cafés, so add a relevant place tag. Just update my profile; no ranking needed.", history: [],
    }), (event) => events.push(event)); }
    finally { spy.mockRestore(); await saveLiveFixture("agent-partner-calls.json", calls); }
    await saveLiveFixture("agent-partner-cafes.json", { result, events });
    expect(result.companion?.loves).toHaveLength(2);
    expect(result.companion?.loves.find((l) => l.query.toLowerCase() === "succession")?.chosen?.domain).toBe("tv_show");
    expect(events.some((e) => e.type === "trace" && e.tool === "search_place_tags")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done" });
    console.info("Live partner/cafes:", { partnerLoves: result.companion?.loves.length, refinements: result.refinements.map((t) => t.name), tools: events.filter((e) => e.type === "trace").length });
  }, 60_000);

  it("connects an intake profile to the real field and ranking engine", async () => {
    const intake = await extractTastes({ text: "I love Radiohead, moving to Lisbon" });
    const state = AgentRequest.shape.state.parse({ city: intake.city ?? "Lisbon", loves: intake.loves });
    const field = await buildField(state);
    const neighborhoods = await rankNeighborhoods(state, field);
    await saveLiveFixture("intake-ranking.json", { state, field, neighborhoods });
    expect(field.cells.length).toBeGreaterThan(0);
    expect(neighborhoods.length).toBeGreaterThan(0);
    console.info("Live intake/engine:", { city: state.city, cells: field.cells.length, top: neighborhoods.slice(0, 3).map((n) => n.name) });
  }, 60_000);
});
