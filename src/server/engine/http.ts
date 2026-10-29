import type { z } from "zod";
import { ApiError, apiError } from "@/shared/contracts";

export function errorResponse(error: unknown): Response {
  const parsed = ApiError.safeParse(error);
  const body = parsed.success ? parsed.data : apiError("qloo_unavailable", "The taste engine could not complete the request.", true);
  const statuses = { bad_input: 400, not_found: 404, sparse_city: 404, quota: 429, qloo_unavailable: 502, llm_unavailable: 502 };
  return Response.json(body, { status: statuses[body.error.code] });
}

export async function jsonRoute<T>(request: Request, schema: z.ZodType<T>, run: (input: T) => Promise<unknown>): Promise<Response> {
  try {
    let body: unknown;
    try { body = await request.json(); } catch { throw apiError("bad_input", "Request body must be valid JSON."); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw apiError("bad_input", "Request does not match the expected input.");
    return Response.json(await run(parsed.data));
  } catch (error) { return errorResponse(error); }
}
