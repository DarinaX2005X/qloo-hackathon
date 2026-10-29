import { ApiError, apiError, type ErrorCode } from "@/shared/contracts";

export class AgentFailure extends Error {
  constructor(public readonly body: ApiError, public readonly status: number) {
    super(body.error.message);
    this.name = "AgentFailure";
  }
}

export function fail(code: ErrorCode, message: string, status = 502, retryable = false): AgentFailure {
  return new AgentFailure(apiError(code, message, retryable), status);
}

export function asFailure(error: unknown, source: "llm" | "qloo" = "llm"): AgentFailure {
  if (error instanceof AgentFailure) return error;
  const wrapped = error as { body?: unknown; status?: number; code?: unknown } | null;
  const parsed = ApiError.safeParse(wrapped?.body ?? error);
  if (parsed.success) {
    const code = parsed.data.error.code;
    const status = code === "bad_input" ? 400 : code === "not_found" ? 404 : code === "quota" ? 429 : 502;
    return new AgentFailure(parsed.data, status);
  }
  if (wrapped?.status === 429 || wrapped?.code === "quota") {
    return fail("quota", "The service is busy. Please try again shortly.", 429, true);
  }
  return source === "qloo"
    ? fail("qloo_unavailable", "Taste data is temporarily unavailable. Please try again.", 502, true)
    : fail("llm_unavailable", "The assistant is temporarily unavailable. Please try again.", 502, true);
}

/** Also bounds dependencies whose API does not accept an AbortSignal. */
export async function withSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => {});
    throw fail("llm_unavailable", "The assistant timed out. Please try again.", 502, true);
  }
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(fail("llm_unavailable", "The assistant timed out. Please try again.", 502, true));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
