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
import type {
  AgentEventV2,
  AgentRequestV2,
  CitiesResponseV2,
  Constraint,
  DecidesResponseV2,
  FieldResponseV2,
  HomeResponseV2,
  LonLat,
  NeighborhoodsResponseV2,
  PlaceIntentV2,
  PlacesResponseV2,
  PlanResponseV2,
  ResultMeta,
  SearchResponseV2,
  SourceAreaV2,
  SpotResponseV2,
} from "@/shared/contracts-09";

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
/** A taste search that has not answered by then is shown as failed, with Retry and Remove. */
export const SEARCH_TIMEOUT_MS = 12_000;

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
};

// ---------------------------------------------------------------- stage 09 (v2) wrappers
// Every v2 call sends one hybrid body: the v2 envelope ({ responseVersion: 2, state, stateRevision, constraints, ... })
// plus, where a legacy route still parses the bare ExploreState, the state's own fields at the top level. A route that
// already speaks v2 answers with `meta`; a legacy route ignores the extra keys and answers the old shape, which the
// caller adapts. So nothing is requested twice while B moves routes over.

export type V2Envelope = { stateRevision: number; constraints?: Constraint[] };
const envelope = (s: ExploreState, e: V2Envelope) => ({ responseVersion: 2 as const, state: s, stateRevision: e.stateRevision, constraints: e.constraints ?? [] });
/** For routes whose legacy body was the bare state. */
const hybrid = (s: ExploreState, e: V2Envelope, extra: Record<string, unknown> = {}) => ({ ...s, ...envelope(s, e), ...extra });
const isV2 = (body: unknown): body is { meta: ResultMeta } => !!body && typeof body === "object" && "meta" in body && !!(body as { meta?: unknown }).meta;

export type Versioned<V2, V1> = { v: 2; data: V2 } | { v: 1; data: V1 };
const versioned = <V2, V1>(body: unknown): Versioned<V2, V1> => (isV2(body) ? { v: 2, data: body as V2 } : { v: 1, data: body as V1 });

export const api2 = {
  search: (q: string, domain?: Domain, signal?: AbortSignal) =>
    call<{ results: EntityRef[]; resolution?: SearchResponseV2["resolution"] }>(`/api/search?q=${encodeURIComponent(q)}${domain ? `&domain=${domain}` : ""}&v=2`, { signal }),
  field: (s: ExploreState, e: V2Envelope, signal?: AbortSignal) =>
    call<unknown>("/api/field", { json: hybrid(s, e), signal }).then((b) => versioned<FieldResponseV2, TasteField>(b)),
  areas: (s: ExploreState, e: V2Envelope, signal?: AbortSignal) =>
    call<unknown>("/api/neighborhoods", { json: hybrid(s, e), signal }).then((b) => versioned<NeighborhoodsResponseV2, { neighborhoods: Neighborhood[] }>(b)),
  places: (s: ExploreState, e: V2Envelope & { areaId: string; intent?: PlaceIntentV2; excludeIds?: string[]; radiusM?: number }, signal?: AbortSignal) =>
    call<unknown>("/api/places", {
      json: hybrid(s, e, { neighborhoodId: e.areaId, areaId: e.areaId, intent: e.intent ?? "daily_life", excludeIds: e.excludeIds ?? [], ...(e.radiusM ? { radiusM: e.radiusM } : {}) }),
      signal,
    }).then((b) => versioned<PlacesResponseV2, { places: Place[] }>(b)),
  home: (s: ExploreState, e: V2Envelope & { source: SourceAreaV2; lambda?: number }, signal?: AbortSignal) =>
    call<unknown>("/api/home", { json: { ...envelope(s, e), source: e.source, lambda: e.lambda ?? 0, blend: e.lambda ?? 0 }, signal }).then((b) =>
      versioned<HomeResponseV2, HomeResult>(b),
    ),
  spot: (s: ExploreState, e: V2Envelope & { query?: string; point?: LonLat; analysisId?: string; areaId?: string }, signal?: AbortSignal) => {
    const { query, point, analysisId, areaId } = e;
    return call<unknown>("/api/spot", {
      json: { ...envelope(s, e), ...(query ? { query } : {}), ...(point ? { point } : {}), ...(analysisId ? { analysisId } : {}), ...(areaId ? { areaId } : {}) },
      signal,
    }).then((b) => versioned<SpotResponseV2, SpotResult>(b));
  },
  decides: (s: ExploreState, e: V2Envelope & { analysisId?: string; areaId?: string }, signal?: AbortSignal) =>
    call<unknown>("/api/decides", { json: hybrid(s, e, { ...(e.analysisId ? { analysisId: e.analysisId } : {}), ...(e.areaId ? { areaId: e.areaId } : {}) }), signal }).then((b) =>
      versioned<DecidesResponseV2, DecidesResult>(b),
    ),
  cities: (s: ExploreState, e: V2Envelope & { cities: string[]; source?: SourceAreaV2; criteria?: string[] }, signal?: AbortSignal) =>
    call<unknown>("/api/cities", {
      json: { ...envelope(s, e), cities: e.cities, ...(e.source ? { source: e.source } : {}), criteria: e.criteria ?? [] },
      signal,
    }).then((b) => versioned<CitiesResponseV2, { cities: CityScore[] }>(b)),
  plan: (
    s: ExploreState,
    e: V2Envelope & { areaIds: string[]; includeIds?: string[]; excludeIds?: string[]; existingItinerary?: Itinerary; replacePlaceId?: string; date?: string; startHour?: number },
    legacy: { excludeCategories?: Category[]; excludeTags?: string[] } = {},
    signal?: AbortSignal,
  ) =>
    call<unknown>("/api/plan", {
      json: hybrid(s, e, {
        areaIds: e.areaIds,
        includeIds: e.includeIds ?? [],
        excludeIds: e.excludeIds ?? [],
        ...(e.existingItinerary ? { existingItinerary: e.existingItinerary } : {}),
        ...(e.replacePlaceId ? { replacePlaceId: e.replacePlaceId } : {}),
        ...(e.date ? { date: e.date } : {}),
        ...(e.startHour !== undefined ? { startHour: e.startHour } : {}),
        // legacy names
        neighborhoodIds: e.areaIds,
        exclude: e.excludeIds ?? [],
        include: e.includeIds ?? [],
        ...(legacy.excludeCategories?.length ? { excludeCategories: legacy.excludeCategories } : {}),
        ...(legacy.excludeTags?.length ? { excludeTags: legacy.excludeTags } : {}),
      }),
      signal,
    }).then((b) => versioned<PlanResponseV2, Itinerary>(b)),
};

/** Either stream event generation: v2 events carry a turnId. */
export type AnyAgentEvent = AgentEvent | AgentEventV2;
export const isV2Event = (e: AnyAgentEvent): e is AgentEventV2 => typeof (e as { turnId?: unknown }).turnId === "string";

/** Streams the v2 agent with the v1 fields alongside, so a legacy route still answers. */
export function streamAgentV2(body: AgentRequestV2, onEvent: (e: AnyAgentEvent) => void, signal?: AbortSignal) {
  const legacy = { state: body.state, message: body.message, history: body.history.slice(-20) };
  return streamAgent({ ...legacy, ...body } as typeof legacy, onEvent as (e: AgentEvent) => void, signal);
}

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
