import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { jsonRoute } from "@/server/engine/http";
import { ExploreState } from "@/shared/contracts";
import { AnalysisRequestV2 } from "@/shared/contracts-09";
import { AgentEventV2, AgentRequestV2, AreaMetrics, HomeRequestV2, NeighborhoodsResponseV2, PlanResponseV2, emptySessionMemory } from "@/shared/contracts-09";
import { FICTIONAL_COMPLETE_09, FICTIONAL_PARTIAL_09 } from "@/shared/fixtures-09";

describe("stage 09 shared wire contract", () => {
  it("never downgrades a malformed declared v2 hybrid body to the legacy engine", async () => {
    const run = vi.fn(async () => ({ legacy: true }));
    const response = await jsonRoute(new Request("http://localhost/api/contract-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...FICTIONAL_COMPLETE_09.state, responseVersion: 2, state: FICTIONAL_COMPLETE_09.state, stateRevision: -1 }) }), z.union([AnalysisRequestV2, ExploreState]), run);
    expect(response.status).toBe(400); expect(run).not.toHaveBeenCalled();
  });
  it("accepts the complete and partial fictional UI handoffs", () => {
    for (const fixture of [FICTIONAL_COMPLETE_09, FICTIONAL_PARTIAL_09]) {
      expect(NeighborhoodsResponseV2.safeParse(fixture.neighborhoods).success).toBe(true);
      expect(PlanResponseV2.safeParse(fixture.visit).success).toBe(true);
      fixture.events.forEach(event => expect(AgentEventV2.safeParse(event).success).toBe(true));
      expect(fixture.fictional).toBe(true);
    }
  });
  it("rejects unversioned cards and unavailable evidence provenance", () => {
    expect(AgentEventV2.safeParse({ type: "result", turnId: "t", card: { kind: "areas", areas: [] } }).success).toBe(false);
    expect(AgentEventV2.safeParse({ type: "observation", turnId: "t", goalId: "g", text: "Found one" }).success).toBe(false);
    expect(AreaMetrics.safeParse({ ...FICTIONAL_COMPLETE_09.neighborhoods.areas[0].metrics, tasteScore: 85 }).success).toBe(false);
  });
  it("bounds memory and home blending at the HTTP boundary", () => {
    expect(HomeRequestV2.safeParse({ state: FICTIONAL_COMPLETE_09.state, stateRevision: 1, source: { city: "A", neighborhood: "B" }, lambda: 0.7 }).success).toBe(false);
    const request = { responseVersion: 2, sessionId: "s", turnId: "t", stateRevision: 1, state: FICTIONAL_COMPLETE_09.state, memory: emptySessionMemory(), message: "Find an area" };
    expect(AgentRequestV2.safeParse(request).success).toBe(true);
    expect(AgentRequestV2.safeParse({ ...request, memory: { ...request.memory, rejectedPlaceIds: Array.from({ length: 101 }, (_, i) => String(i)) } }).success).toBe(false);
  });
});
