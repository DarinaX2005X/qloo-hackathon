import type { z } from "zod";
import { ApiError, apiError } from "@/shared/contracts";
import { rateLimitedQloo } from "./rate-limit";

export function errorResponse(error: unknown): Response {
  const parsed = ApiError.safeParse(error);
  const body = parsed.success ? parsed.data : apiError("qloo_unavailable", "The taste engine could not complete the request.", true);
  const statuses = { bad_input: 400, not_found: 404, sparse_city: 404, quota: 429, qloo_unavailable: 502, llm_unavailable: 502 };
  const retryAfter = error && typeof error === "object" && "retryAfter" in error && typeof error.retryAfter === "number" && Number.isFinite(error.retryAfter)
    ? Math.max(1, Math.ceil(error.retryAfter)) : 10;
  return Response.json(body, { status: statuses[body.error.code], ...(body.error.code === "quota" ? { headers: { "Retry-After": String(retryAfter) } } : {}) });
}

export async function jsonRoute<T>(request: Request, schema: z.ZodType<T>, run: (input: T) => Promise<unknown>): Promise<Response> {
  try {
    return await rateLimitedQloo(request, async () => {
      let body: unknown;
      try { body = await request.json(); } catch { throw apiError("bad_input", "Request body must be valid JSON."); }
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw apiError("bad_input", "Request does not match the expected input.");
      return Response.json(await run(parsed.data));
    });
  } catch (error) { return errorResponse(error); }
}
