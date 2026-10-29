import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentRequest, type AgentEvent, type ExploreState, type StatePatch } from "@/shared/contracts";
import { resolveLove } from "@/server/agent/intake";
import { POST } from "@/app/api/agent/route";
import * as engine from "@/server/engine";

const fixtures = join(process.cwd(), "tests/agent/__fixtures__");
export const LIVE_MESSAGES = ["less touristy", "I work from cafés", "add my partner: techno and Succession", "actually let's look at Berlin for 3 days"];

export function parseEvents(sse: string): AgentEvent[] {
  return sse.trim().split("\n\n").map((frame) => {
    const lines = frame.split("\n");
    return { type: lines.find((line) => line.startsWith("event: "))?.slice(7), ...JSON.parse(lines.find((line) => line.startsWith("data: "))!.slice(6)) } as AgentEvent;
  });
}

export function compactPatch(op: StatePatch): unknown {
  if (op.op === "set_companion") return { op: op.op, loves: op.loves?.map((love) => ({ query: love.query, chosen: love.chosen?.name ?? null })) ?? null };
  if (op.op === "add_refinement") return { op: op.op, tag: op.tag.name };
  if (op.op === "add_love") return { op: op.op, query: op.love.query, chosen: op.love.chosen?.name ?? null };
  return op;
}

describe.skipIf(process.env.QLOO_LIVE !== "1")("live integrated agent on Lisbon + Radiohead", () => {
  let state: ExploreState;
  beforeAll(async () => {
    process.loadEnvFile?.(".env.local");
    const love = await resolveLove("Radiohead", "artist");
    expect(love.chosen?.name).toBe("Radiohead");
    state = AgentRequest.shape.state.parse({ city: "Lisbon", loves: [love] });
    await mkdir(fixtures, { recursive: true });
  });
  afterEach(() => vi.restoreAllMocks());

  for (const [index, message] of LIVE_MESSAGES.entries()) {
    it(message, async () => {
      const realRank = engine.rankNeighborhoods;
      const rankings: Awaited<ReturnType<typeof realRank>>[] = [];
      vi.spyOn(engine, "rankNeighborhoods").mockImplementation(async (...args) => {
        const result = await realRank(...args);
        rankings.push(result);
        return result;
      });
      const response = await POST(new Request("http://localhost/api/agent", {
        method: "POST", body: JSON.stringify({ state: structuredClone(state), message, history: [] }),
      }));
      const sse = await response.text();
      const events = parseEvents(sse);
      const trace = events.filter((event) => event.type === "trace").map(({ tool, summary }) => ({ tool, summary }));
      const ops = events.filter((event) => event.type === "patch").flatMap((event) => event.ops);
      const final = events.filter((event) => event.type === "delta").map((event) => event.text).join("");
      const top = rankings.at(-1)?.[0]?.name ?? null;
      const report = { message, trace, patch: ops.map(compactPatch), top, final };
      await writeFile(join(fixtures, `integration-${index + 1}.json`), JSON.stringify({ report, events, rankings }, null, 2));
      console.info(JSON.stringify(report, null, 2));
      expect(response.status).toBe(200);
      expect(events.at(-1)).toEqual({ type: "done" });
      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(ops.length).toBeGreaterThan(0);
      expect(trace.map((event) => event.summary).join(" ")).not.toMatch(/preserve|invalid|validation|proposed change|before adding|bad_input/i);
      expect(final).not.toMatch(/as an ai|sorry|apolog|limit|continue|timed out/i);
      expect(rankings.length).toBeGreaterThan(0);
      expect(top).toBeTruthy();
      expect(final).toContain(top);
      const patchPosition = events.findIndex((event) => event.type === "patch");
      expect(events.findIndex((event, i) => i > patchPosition && event.type === "trace" && event.tool === "get_ranking")).toBeGreaterThan(patchPosition);
      if (index === 0) expect(ops).toContainEqual(expect.objectContaining({ op: "set_discovery", value: expect.any(Number) }));
      if (index === 1) {
        const refinements = ops.filter((op) => op.op === "add_refinement");
        expect(refinements.length).toBeGreaterThan(0);
        expect(refinements.length).toBeLessThanOrEqual(2);
        expect(refinements.some((op) => /laptop|wi.?fi|caf[eé]/i.test(op.tag.name))).toBe(true);
      }
      if (index === 2) {
        const companion = ops.find((op) => op.op === "set_companion");
        expect(companion?.loves).toHaveLength(2);
        expect(companion?.loves?.some((love) => love.chosen?.name === "Succession")).toBe(true);
        expect(companion?.loves?.find((love) => love.query.toLowerCase() === "techno")?.chosen).toBeNull();
      }
      if (index === 3) {
        expect(ops).toContainEqual({ op: "set_city", city: "Berlin" });
        expect(ops).toContainEqual({ op: "set_days", days: 3 });
      }
    }, 60_000);
  }
});
