import { AgentRequest, type AgentEvent } from "@/shared/contracts";
import { AgentRequestV2, type AgentEventV2 } from "@/shared/contracts-09";
import { asFailure, fail, withSignal } from "@/server/agent/errors";
import { enforceRateLimit, QLOO_REQUEST_LIMITS, type RateReservation } from "@/server/engine/rate-limit";
import { withQlooBudget } from "@/server/qloo/budget";
import { errorResponse } from "@/server/engine/http";
import { acknowledgement, AGENT09_TIMEOUT_MS, serializeEventV2 } from "@/server/agent/09/protocol";
import { setImmediate as yieldToIO } from "node:timers/promises";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  let reservation: RateReservation | undefined;
  try { reservation = enforceRateLimit(request); } catch (error) { return errorResponse(error); }
  const raw = await request.json().catch(() => null);
  const isV2 = raw?.responseVersion === 2;
  const input = isV2 ? AgentRequestV2.safeParse(raw) : AgentRequest.safeParse(raw);
  if (!input.success || !input.data.message.trim()) {
    reservation?.finish(0);
    const failure = fail("bad_input", `Provide a valid profile and a message of 1–${isV2 ? 2000 : 1000} characters.`, 400);
    return Response.json(failure.body, { status: failure.status });
  }
  const encoder = new TextEncoder();
  const accepted = performance.now();
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal]);
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent): void => {
        const { type, ...data } = event;
        if (!signal.aborted) controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const emitV2 = (event: AgentEventV2): void => {
        if (!signal.aborted) controller.enqueue(encoder.encode(serializeEventV2(event)));
      };
      try { await withQlooBudget(reservation?.limit ?? QLOO_REQUEST_LIMITS["/api/agent"], async () => {
        if (isV2) {
          const requestV2 = AgentRequestV2.parse(input.data);
          emitV2({ type: "ack", turnId: requestV2.turnId, text: acknowledgement(requestV2.message) });
          // Flush the accepted stream before loading the engine or starting any
          // model/provider work. Engine startup counts against the turn deadline.
          await yieldToIO();
          const { runAgentV2 } = await withSignal(import("@/server/agent/09/runner"), AbortSignal.any([signal, AbortSignal.timeout(AGENT09_TIMEOUT_MS)]));
          await runAgentV2(requestV2, emitV2, signal, { acknowledged: true, deadlineMs: Math.max(1, AGENT09_TIMEOUT_MS - (performance.now() - accepted)) });
        } else {
          const { runAgent } = await import("@/server/agent/runner");
          await runAgent(AgentRequest.parse(input.data), emit, signal);
        }
      }, reservation?.finish); }
      catch (error) {
        const failure = asFailure(error).body.error;
        if (isV2) {
          emitV2({ type: "error", turnId: raw.turnId, retryable: failure.retryable ?? false, message: failure.message });
          emitV2({ type: "answer", turnId: raw.turnId, claims: [{ text: "This check could not be completed. Please retry it.", evidenceIds: [] }] });
          emitV2({ type: "done", turnId: raw.turnId, goals: [{ id: `${raw.turnId}:startup`, kind: "choose_area", status: "failed", resultIds: [], unmet: [failure.message] }], memory: AgentRequestV2.parse(input.data).memory });
        }
        else emit({ type: "error", error: failure });
      }
      finally { if (!cancellation.signal.aborted) controller.close(); }
    },
    cancel() { cancellation.abort(); },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
