import { ApiError, IntakeRequest } from "@/shared/contracts";
import { asFailure, fail } from "@/server/agent/errors";
import { extractTastes } from "@/server/agent/intake";
import { rateLimitedQloo } from "@/server/engine/rate-limit";
import { errorResponse } from "@/server/engine/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    return await rateLimitedQloo(request, async () => {
      const input = IntakeRequest.safeParse(await request.json().catch(() => null));
      if (!input.success) throw fail("bad_input", "Provide text or an image of things you love.", 400);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(40_000)]);
      return Response.json(await extractTastes(input.data, signal));
    });
  } catch (error) {
    const failure = asFailure(error);
    if (failure.body.error.code === "quota") return errorResponse(ApiError.safeParse(error).success ? error : failure.body);
    return Response.json(failure.body, { status: failure.status });
  }
}
