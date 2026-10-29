import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentRequest, type AgentEvent, type ExploreState, type StatePatch } from "@/shared/contracts";
import { POST } from "@/app/api/agent/route";
import { resolveLove } from "@/server/agent/intake";
import * as engine from "@/server/engine";

const fixtures = join(process.cwd(), "tests/agent/__fixtures__");
export const PREFERENCE_CASES: { message: string; ops: StatePatch[]; ranking: boolean; words: RegExp }[] = [
  { message: "on a budget", ops: [{ op: "set_budget", budget: 2 }], ranking: false, words: /\$\$|budget|affordable|inexpensive/i },
  { message: "cheap eats", ops: [{ op: "set_budget", budget: 2 }], ranking: false, words: /\$\$|budget|affordable|inexpensive/i },
  { message: "money is no object", ops: [{ op: "set_budget", budget: null }], ranking: false, words: /price|budget|cap|limit/i },
  { message: "I'm not a morning person", ops: [{ op: "set_start", hour: 11 }], ranking: false, words: /11(?::00)?/ },
  { message: "early bird", ops: [{ op: "set_start", hour: 7 }], ranking: false, words: /0?7(?::00)?/ },
  { message: "slow trip, not too much", ops: [{ op: "set_pace", pace: "relaxed" }], ranking: false, words: /relax|slow|leisure|fewer/i },
  { message: "pack it in", ops: [{ op: "set_pace", pace: "packed" }], ranking: false, words: /pack|busy|more stops|full/i },
  { message: "remove Fleabag", ops: [{ op: "remove_love", query: "Fleabag" }], ranking: true, words: /Fleabag/i },
  { message: "forget the Patagonia thing", ops: [{ op: "remove_love", query: "Patagonia" }], ranking: true, words: /Patagonia/i },
  { message: "Radiohead matters less", ops: [{ op: "set_weight", query: "Radiohead", weight: 0.5 }], ranking: true, words: /Radiohead/i },
  { message: "less touristy, on a budget, I sleep late", ops: [{ op: "set_discovery", value: 0.7 }, { op: "set_budget", budget: 2 }, { op: "set_start", hour: 11 }], ranking: true, words: /11(?::00)?/ },
];

export async function readPreferenceEvents(response: Response, began: number): Promise<{ events: AgentEvent[]; firstTraceMs: number | null; firstDeltaMs: number | null; doneMs: number }> {
  const events: AgentEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "", firstTraceMs: number | null = null, firstDeltaMs: number | null = null, doneMs = 0;
  while (true) {
    const next = await reader.read(); buffer += decoder.decode(next.value, { stream: !next.done });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const lines = buffer.slice(0, end).split("\n"); buffer = buffer.slice(end + 2);
      const event = { type: lines.find((line) => line.startsWith("event: "))!.slice(7), ...JSON.parse(lines.find((line) => line.startsWith("data: "))!.slice(6)) } as AgentEvent;
      const elapsed = Math.round(performance.now() - began); events.push(event);
      if (event.type === "trace") firstTraceMs ??= elapsed;
      if (event.type === "delta") firstDeltaMs ??= elapsed;
      if (event.type === "done") doneMs = elapsed;
    }
    if (next.done) break;
  }
  return { events, firstTraceMs, firstDeltaMs, doneMs };
}

describe.skipIf(process.env.QLOO_LIVE !== "1")("live budget, pace, start and taste edits", () => {
  let state: ExploreState;
  beforeAll(async () => {
    process.loadEnvFile?.(".env.local");
    const loves = await Promise.all([resolveLove("Radiohead", "artist"), resolveLove("Fleabag", "tv_show"), resolveLove("Patagonia", "brand")]);
    expect(loves.every((love) => love.chosen)).toBe(true);
    state = AgentRequest.shape.state.parse({ city: "Lisbon", loves, budget: 3 });
    await mkdir(fixtures, { recursive: true });
  });
  afterEach(() => vi.restoreAllMocks());

  for (const [index, sample] of PREFERENCE_CASES.entries()) {
    it(sample.message, async () => {
      const rank = engine.rankNeighborhoods;
      let rankingCalls = 0, top: string | null = null;
      vi.spyOn(engine, "rankNeighborhoods").mockImplementation(async (...args) => {
        rankingCalls++; const result = await rank(...args); top = result[0]?.name ?? null; return result;
      });
      const realFetch = globalThis.fetch;
      let modelCalls = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
        if (String(url).includes("openrouter.ai/api/v1/chat/completions")) modelCalls++;
        return realFetch(url, init);
      });
      const began = performance.now();
      const response = await POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify({ state: structuredClone(state), message: sample.message, history: [] }) }));
      const { events, ...timing } = await readPreferenceEvents(response, began);
      const ops = events.filter((event) => event.type === "patch").flatMap((event) => event.ops);
      const text = events.filter((event) => event.type === "delta").map((event) => event.text).join("");
      const report = { message: sample.message, ...timing, modelCalls, rankingCalls, patch: ops, top, text };
      await writeFile(join(fixtures, `preferences-${index + 1}.json`), JSON.stringify({ report, events }, null, 2));
      console.info(JSON.stringify(report, null, 2));
      expect(events.at(-1)).toEqual({ type: "done" }); expect(events.some((event) => event.type === "error")).toBe(false);
      expect(ops).toEqual(expect.arrayContaining(sample.ops)); expect(ops).toHaveLength(sample.ops.length);
      expect(rankingCalls).toBe(sample.ranking ? 1 : 0);
      expect(events.some((event) => event.type === "trace" && event.tool.startsWith("search_"))).toBe(false);
      expect(text).toMatch(sample.words); expect(text).not.toMatch(/sorry|as an ai|reached the limit/i);
      if (sample.ranking) expect(text).toContain(top);
      else expect(text).not.toMatch(/neighborhood|district|best start/i);
      expect(timing.doneMs).toBeLessThan(8000);
    }, 30_000);
  }
});
