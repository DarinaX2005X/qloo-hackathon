import { AgentRequest, type AgentEvent } from "@/shared/contracts";
import { asFailure, fail } from "@/server/agent/errors";
import { runAgent, serializeEvent } from "@/server/agent/runner";
import { enforceRateLimit, QLOO_REQUEST_LIMITS, type RateReservation } from "@/server/engine/rate-limit";
import { withQlooBudget } from "@/server/qloo/budget";
import { errorResponse } from "@/server/engine/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  let reservation: RateReservation | undefined;
  try { reservation = enforceRateLimit(request); } catch (error) { return errorResponse(error); }
  const input = AgentRequest.safeParse(await request.json().catch(() => null));
  if (!input.success || !input.data.message.trim()) {
    reservation?.finish(0);
    const failure = fail("bad_input", "Provide a valid profile and a message of 1–1000 characters.", 400);
    return Response.json(failure.body, { status: failure.status });
  }
  const encoder = new TextEncoder();
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal]);
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent): void => {
        if (!signal.aborted) controller.enqueue(encoder.encode(serializeEvent(event)));
      };
      try { await withQlooBudget(reservation?.limit ?? QLOO_REQUEST_LIMITS["/api/agent"], () => runAgent(input.data, emit, signal), reservation?.finish); }
      catch (error) { emit({ type: "error", error: asFailure(error).body.error }); }
      finally { if (!cancellation.signal.aborted) controller.close(); }
    },
    cancel() { cancellation.abort(); },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
