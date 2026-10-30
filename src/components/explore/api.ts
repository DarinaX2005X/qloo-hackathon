import { quotaText } from "@/lib/honest";
import type {
  AgentEvent,
  CityScore,
  ApiError,
  DecidesResult,
  HomeResult,
  SpotResult,
  Category,
  Domain,
  EntityRef,
  ExploreState,
  Fingerprint,
  Itinerary,
  Neighborhood,
  Place,
  ResolvedLove,
  TagRef,
  TasteField,
} from "@/shared/contracts";

export class HomingError extends Error {
  constructor(
    public code: ApiError["error"]["code"] | "network" | "aborted",
    message: string,
    public retryable = true,
  ) {
    super(message);
  }
}

async function once<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      method: json !== undefined ? "POST" : "GET",
      headers: json !== undefined ? { "content-type": "application/json" } : undefined,
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new HomingError("aborted", "aborted", false);
    throw new HomingError("network", "You seem to be offline. Check the connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiError | null)?.error;
    // a rate limit is not a failure: say so plainly, next to the action, and let the person try again
    if (res.status === 429 || err?.code === "quota") throw new HomingError("quota", quotaText(), true);
    throw new HomingError(err?.code ?? "qloo_unavailable", err?.message ?? "Something went wrong on our side.", err?.retryable ?? true);
  }
  return body as T;
}

const RETRY_MS = [900, 2400];

/** Retries transient failures (cold start, network) quietly before the person sees an error. A rate limit
 *  is shown at once: the bucket refills over ~10 s, longer than a quiet retry should hang. */
async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await once<T>(path, init);
    } catch (e) {
      const err = e as HomingError;
      const transient = err.retryable && (err.code === "network" || err.code === "qloo_unavailable");
      if (!transient || attempt >= RETRY_MS.length || init.signal?.aborted) throw err;
      await new Promise((r) => setTimeout(r, RETRY_MS[attempt]));
      if (init.signal?.aborted) throw new HomingError("aborted", "aborted", false);
    }
  }
}

export const api = {
  search: (q: string, domain?: Domain, signal?: AbortSignal) =>
    call<{ results: EntityRef[] }>(`/api/search?q=${encodeURIComponent(q)}${domain ? `&domain=${domain}` : ""}`, { signal }).then((r) => r.results),
  tags: (q: string, signal?: AbortSignal) => call<{ results: TagRef[] }>(`/api/tags?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.results),
  intake: (body: { text?: string; image?: string }, signal?: AbortSignal) =>
    call<{ loves: ResolvedLove[]; city?: string }>("/api/intake", { json: body, signal }),
  field: (s: ExploreState, signal?: AbortSignal) => call<TasteField>("/api/field", { json: s, signal }),
  neighborhoods: (s: ExploreState, signal?: AbortSignal) =>
    call<{ neighborhoods: Neighborhood[] }>("/api/neighborhoods", { json: s, signal }).then((r) => r.neighborhoods),
  fingerprint: (s: ExploreState, signal?: AbortSignal) => call<Fingerprint>("/api/fingerprint", { json: s, signal }),
  places: (s: ExploreState, neighborhoodId: string, categories?: Category[], signal?: AbortSignal) =>
    call<{ places: Place[] }>("/api/places", { json: { ...s, neighborhoodId, categories }, signal }).then((r) => r.places),
  plan: (
    s: ExploreState,
    neighborhoodIds: string[],
    opts: { exclude?: string[]; include?: string[]; excludeCategories?: Category[]; excludeTags?: string[] } = {},
    signal?: AbortSignal,
  ) =>
    call<Itinerary>("/api/plan", {
      json: {
        ...s,
        neighborhoodIds,
        exclude: opts.exclude ?? [],
        include: opts.include ?? [],
        ...(opts.excludeCategories?.length ? { excludeCategories: opts.excludeCategories } : {}),
        ...(opts.excludeTags?.length ? { excludeTags: opts.excludeTags } : {}),
      },
      signal,
    }),
  home: (s: ExploreState, source: { city: string; neighborhood: string; point?: [number, number] }, blend = 0, signal?: AbortSignal) =>
    call<HomeResult>("/api/home", { json: { state: s, source, blend }, signal }),
  spot: (s: ExploreState, where: { query?: string; point?: [number, number] }, signal?: AbortSignal) =>
    call<SpotResult>("/api/spot", { json: { state: s, ...where }, signal }),
  decides: (s: ExploreState, signal?: AbortSignal) => call<DecidesResult>("/api/decides", { json: s, signal }),
  cities: (s: ExploreState, cities: string[], signal?: AbortSignal) =>
    call<{ cities: CityScore[] }>("/api/cities", { json: { state: s, cities }, signal }).then((r) => r.cities),
  /** One city on its own, so each card can appear as soon as it is scored. */
  city: async (s: ExploreState, city: string, signal?: AbortSignal): Promise<CityScore> => {
    if (singleCity !== false) {
      try {
        const [one] = await api.cities(s, [city], signal);
        singleCity = true;
        return one;
      } catch (e) {
        // a server that still wants two or more cities answers bad_input; ask with the city twice instead
        if ((e as HomingError).code !== "bad_input" || singleCity === true) throw e;
        singleCity = false;
      }
    }
    const [one] = await api.cities(s, [city, city], signal);
    return one;
  },
};
/** Whether /api/cities accepts a single city (null until the first answer). */
let singleCity: boolean | null = null;

/** Streams the agent. Calls onEvent for every server-sent event until done or error. */
export async function streamAgent(
  body: { state: ExploreState; message: string; history: { role: "user" | "assistant"; content: string }[] },
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
) {
  let res: Response;
  try {
    res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    onEvent({ type: "error", error: { code: "llm_unavailable", message: "You seem to be offline. Try again.", retryable: true } });
    return;
  }
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as ApiError | null;
    if (res.status === 429 || err?.error?.code === "quota") {
      onEvent({ type: "error", error: { code: "quota", message: quotaText("your question"), retryable: true } });
      return;
    }
    onEvent({ type: "error", error: err?.error ?? { code: "llm_unavailable", message: "The assistant is unavailable right now.", retryable: true } });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    let chunkRead: ReadableStreamReadResult<Uint8Array>;
    try {
      chunkRead = await reader.read();
    } catch (e) {
      // the person pressed Stop: end quietly; anything else is a dropped connection
      if ((e as Error).name !== "AbortError" && !signal?.aborted)
        onEvent({ type: "error", error: { code: "llm_unavailable", message: "The connection dropped before the answer finished. Try again.", retryable: true } });
      return;
    }
    const { value, done } = chunkRead;
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      // SSE frame: an optional "event: <type>" line plus "data: <json>"; the type may live in either
      let type: string | null = null;
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) type = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        const body = JSON.parse(data) as Record<string, unknown>;
        const event = { ...body, type: (body.type as string | undefined) ?? type } as AgentEvent;
        if (event.type === "error" && event.error?.code === "quota") event.error = { ...event.error, message: quotaText("your question") };
        onEvent(event);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
