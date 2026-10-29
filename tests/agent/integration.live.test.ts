import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentRequest, type AgentEvent, type ExploreState, type StatePatch } from "@/shared/contracts";
import { resolveLove } from "@/server/agent/intake";
import { POST } from "@/app/api/agent/route";
import * as engine from "@/server/engine";

const fixtures = join(process.cwd(), "tests/agent/__fixtures__");
export const LIVE_MESSAGES = ["less touristy", "I work from cafés", "add my partner: techno and Succession", "actually let's look at Berlin for 3 days", "Add my partner: techno and Succession"];

export function parseEvents(sse: string): AgentEvent[] {
  return sse.trim().split("\n\n").map((frame) => {
    const lines = frame.split("\n");
    return { type: lines.find((line) => line.startsWith("event: "))?.slice(7), ...JSON.parse(lines.find((line) => line.startsWith("data: "))!.slice(6)) } as AgentEvent;
  });
}

export async function readTimedEvents(response: Response, started: number): Promise<{ events: AgentEvent[]; firstTraceMs: number | null; firstActionTraceMs: number | null; firstDeltaMs: number | null; doneMs: number }> {
  const events: AgentEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstTraceMs: number | null = null, firstActionTraceMs: number | null = null, firstDeltaMs: number | null = null, doneMs = 0;
  while (true) {
    const next = await reader.read();
    buffer += decoder.decode(next.value, { stream: !next.done });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const event = parseEvents(buffer.slice(0, end))[0]; buffer = buffer.slice(end + 2);
      const elapsed = Math.round(performance.now() - started);
      events.push(event);
      if (event.type === "trace") { firstTraceMs ??= elapsed; if (event.tool !== "agent") firstActionTraceMs ??= elapsed; }
      if (event.type === "delta") firstDeltaMs ??= elapsed;
      if (event.type === "done") doneMs = elapsed;
    }
    if (next.done) break;
  }
  return { events, firstTraceMs, firstActionTraceMs, firstDeltaMs, doneMs };
}

export function compactPatch(op: StatePatch): unknown {
  if (op.op === "set_companion") return { op: op.op, loves: op.loves?.map((love) => ({ query: love.query, chosen: love.chosen?.name ?? null })) ?? null };
  if (op.op === "add_refinement") return { op: op.op, tag: op.tag.name };
  if (op.op === "add_love") return { op: op.op, query: op.love.query, chosen: op.love.chosen?.name ?? null };
  return op;
}

describe.skipIf(process.env.QLOO_LIVE !== "1")("live integrated agent on Lisbon + Radiohead + Fleabag", () => {
  let state: ExploreState;
  beforeAll(async () => {
    process.loadEnvFile?.(".env.local");
    const loves = await Promise.all([resolveLove("Radiohead", "artist"), resolveLove("Fleabag", "tv_show")]);
    expect(loves.every((love) => love.chosen)).toBe(true);
    state = AgentRequest.shape.state.parse({ city: "Lisbon", loves });
    await mkdir(fixtures, { recursive: true });
  });
  afterEach(() => vi.restoreAllMocks());

  for (const [index, message] of LIVE_MESSAGES.entries()) {
    it(message, async () => {
      const realRank = engine.rankNeighborhoods;
      const rankings: Awaited<ReturnType<typeof realRank>>[] = [];
      let rankingMs = 0;
      vi.spyOn(engine, "rankNeighborhoods").mockImplementation(async (...args) => {
        const began = performance.now(); const result = await realRank(...args); rankingMs += Math.round(performance.now() - began); rankings.push(result); return result;
      });
      const realFetch = globalThis.fetch;
      const modelCalls: Record<string, unknown>[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        const modelCall = String(url).includes("openrouter.ai/api/v1/chat/completions");
        let record: Record<string, unknown> | undefined;
        if (modelCall) {
          const body = JSON.parse(String(init?.body));
          record = { reasoning: body.reasoning, max_tokens: body.max_tokens, tools: !!body.tools, stream: body.stream };
          modelCalls.push(record);
        }
        const began = performance.now(); const result = await realFetch(url, init);
        if (record) {
          record.headersMs = Math.round(performance.now() - began); record.status = result.status;
          if (!record.stream) {
            const payload = await result.clone().json();
            record.finish = payload.choices?.[0]?.finish_reason; record.plan = payload.choices?.[0]?.message?.content; record.usage = payload.usage;
          }
        }
        return result;
      });
      const started = performance.now();
      const response = await POST(new Request("http://localhost/api/agent", {
        method: "POST", body: JSON.stringify({ state: structuredClone(state), message, history: [] }),
      }));
      const timing = await readTimedEvents(response, started);
      const { events, ...times } = timing;
      const trace = events.filter((event) => event.type === "trace").map(({ tool, summary }) => ({ tool, summary }));
      const ops = events.filter((event) => event.type === "patch").flatMap((event) => event.ops);
      const final = events.filter((event) => event.type === "delta").map((event) => event.text).join("");
      const top = rankings.at(-1)?.[0]?.name ?? null;
      const report = { message, ...times, rankingMs, modelCalls: modelCalls.length, trace, patch: ops.map(compactPatch), top, final };
      await writeFile(join(fixtures, `speed-${index + 1}.json`), JSON.stringify({ report, events, rankings, modelCalls }, null, 2));
      console.info(JSON.stringify(report, null, 2));
      expect(response.status).toBe(200);
      expect(events.at(-1)).toEqual({ type: "done" });
      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(ops.length).toBeGreaterThan(0);
      expect(trace.map((event) => event.summary).join(" ")).not.toMatch(/preserve|invalid|validation|proposed change|before adding|bad_input/i);
      expect(final).not.toMatch(/as an ai|sorry|apolog|limit|continue|timed out/i);
      expect(rankings.length).toBeGreaterThan(0);
      expect(top).toBeTruthy(); expect(final).toContain(top);
      expect(times.firstTraceMs).toBeLessThan(2000);
      expect(times.doneMs).toBeLessThan(26_000);
      if (index === 0) expect(ops).toContainEqual(expect.objectContaining({ op: "set_discovery", value: expect.any(Number) }));
      if (index === 1) {
        const refinements = ops.filter((op) => op.op === "add_refinement");
        expect(refinements.length).toBeGreaterThan(0); expect(refinements.length).toBeLessThanOrEqual(2);
        expect(refinements.some((op) => /laptop|wi.?fi|caf[eé]/i.test(op.tag.name))).toBe(true);
      }
      if (index === 2 || index === 4) {
        const companion = ops.find((op) => op.op === "set_companion");
        expect(companion?.loves?.length).toBeGreaterThanOrEqual(2);
        expect(companion?.loves?.every((love) => love.chosen)).toBe(true);
        expect(companion?.loves?.some((love) => love.chosen?.name === "Succession")).toBe(true);
        expect(final).toMatch(/techno/i); expect(final).toMatch(/reference points?/i);
      }
      if (index === 3) {
        expect(ops).toContainEqual({ op: "set_city", city: "Berlin" }); expect(ops).toContainEqual({ op: "set_days", days: 3 });
      }
    }, 30_000);
  }
});
