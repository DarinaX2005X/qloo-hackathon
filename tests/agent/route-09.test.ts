import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRequestV2, emptySessionMemory } from "@/shared/contracts-09";
import { ExploreState } from "@/shared/contracts";
import { POST } from "@/app/api/agent/route";

const mocks = vi.hoisted(() => ({ run: vi.fn(), finish: vi.fn() }));
vi.mock("@/server/agent/09/runner", () => ({ runAgentV2: mocks.run }));
vi.mock("@/server/engine/rate-limit", () => ({ enforceRateLimit: () => ({ limit: 192, finish: mocks.finish }), QLOO_REQUEST_LIMITS: { "/api/agent": 192 } }));
const input = AgentRequestV2.parse({ responseVersion: 2, sessionId: "fictional:http", turnId: "fictional:http:turn", stateRevision: 1, state: ExploreState.parse({ city: "Fictional City", loves: [] }), memory: emptySessionMemory(1), message: "Choose an area", history: [] });
beforeEach(() => { vi.clearAllMocks(); });

describe("accepted v2 HTTP stream", () => {
  it("flushes acknowledgement before waiting for the runner and passes the remaining deadline", async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    mocks.run.mockImplementation(async (_input, emit) => {
      await waiting;
      emit({ type: "done", turnId: input.turnId, goals: [], memory: input.memory });
    });
    const response = await POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify(input) }));
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: ack");
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
    expect(mocks.run.mock.calls[0][3]).toMatchObject({ acknowledged: true });
    expect(mocks.run.mock.calls[0][3].deadlineMs).toBeLessThan(40000);
    finish();
    const last = new TextDecoder().decode((await reader.read()).value);
    expect(last).toContain("event: done");
    expect((await reader.read()).done).toBe(true);
  });
  it("settles an unexpected startup error with an explicit failed goal", async () => {
    mocks.run.mockRejectedValue(new Error("fictional startup failure"));
    const response = await POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify(input) }));
    const body = await response.text();
    expect(body.indexOf("event: ack")).toBeLessThan(body.indexOf("event: error"));
    expect(body).toContain('"status":"failed"');
    expect(body).toContain("event: done");
  });
});
