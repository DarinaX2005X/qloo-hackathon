import { createHash } from "node:crypto";
import { ApiError, apiError } from "@/shared/contracts";
import { consumeQlooCall, withoutQlooBudget } from "./budget";

export type QlooParams = Record<string, string | number | undefined>;
export type QlooRecord = Record<string, unknown>;
type QlooRuntime = {
  cache: Map<string, { value: unknown; expires: number; fetchedAt?: string }>;
  pending: Map<string, Promise<unknown>>;
  active: number;
  queue: (() => void)[];
  generation?: number;
};
const processGlobal = globalThis as typeof globalThis & { __homingQlooRuntimeV10?: QlooRuntime };
const runtime: QlooRuntime = processGlobal.__homingQlooRuntimeV10 ??= { cache: new Map(), pending: new Map(), active: 0, queue: [] };
const { cache, pending } = runtime;
const TTL = 604800;
const PARSER_VERSION = "stage09-native-ranks-explainability-v1";

export function record(value: unknown): QlooRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as QlooRecord : {};
}

export function records(value: unknown): QlooRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

export function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function unit(value: unknown): number {
  return Math.max(0, Math.min(1, number(value)));
}

export function resultRows(value: unknown, key: "entities" | "tags" | "heatmap"): QlooRecord[] {
  const results = record(value).results;
  const rows = Array.isArray(results) ? results : record(results)[key];
  if (!Array.isArray(rows)) throw apiError("qloo_unavailable", "Qloo returned an unexpected response.", true);
  return records(rows);
}

const RETAINED_FIELDS = new Set([
    "results", "entities", "tags", "heatmap", "entity_id", "id", "tag_id", "name", "type", "types", "subtype",
    "properties", "location", "latitude", "longitude", "lat", "lon", "geohash", "query", "popularity", "affinity", "affinity_rank",
    "image", "images", "url", "website", "description", "short_description", "neighborhood", "geocode", "hours", "price_level", "address", "weight",
    "keywords", "count", "parents", "is_closed", "primary_genre", "opens", "closes", "closed", "place_type",
    "explainability", "signal.interests.entities", "warning", "warnings", "score", "references_brand", "brand", "brands",
    "city", "country", "country_code", "admin1_region", "admin2_region", "locality", "neighbourhood",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);
/** Keep only fields used by the engine before retaining a response in memory. */
export function trimResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(trimResponse);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(record(value)).filter(([key]) =>
    RETAINED_FIELDS.has(key) || /^entity_\w+_affinity(?:_rank)?$/.test(key),
  ).map(([key, item]) => [key, key === "description" && typeof item === "string" ? item.slice(0, 160) : trimResponse(item)]));
}

export function clearQlooCache(): void {
  cache.clear();
  runtime.generation = (runtime.generation ?? 0) + 1;
}

export function qlooCacheGeneration(): number {
  return runtime.generation ?? 0;
}

const unavailable = () => apiError("qloo_unavailable", "Qloo is unavailable or the request timed out.", true);

/** Abort is advisory to fetch; this race also bounds transports that ignore it. */
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, ms: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ms);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  let rejectAbort!: () => void;
  const deadline = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(unavailable());
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  try {
    if (controller.signal.aborted) throw unavailable();
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
    controller.abort();
  }
}

export async function acquireQlooSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw unavailable();
  if (runtime.active < 4) { runtime.active++; return; }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    const grant = () => { cleanup(); resolve(); };
    const cancel = () => {
      const index = runtime.queue.indexOf(grant);
      if (index < 0) return; // A granted slot belongs to the caller's finally.
      runtime.queue.splice(index, 1);
      cleanup(); reject(unavailable());
    };
    const timer = setTimeout(cancel, 8000);
    runtime.queue.push(grant);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

export function releaseQlooSlot(): void {
  const next = runtime.queue.shift();
  if (next) next(); // Transfer the occupied slot to the oldest live waiter.
  else runtime.active--;
}

export async function fetchQlooAttempt(url: URL, apiKey: string, signal?: AbortSignal): Promise<{ status: number; value?: unknown }> {
  await acquireQlooSlot(signal);
  try {
    return await bounded(async attemptSignal => {
      const response = await fetch(url, {
        method: "GET", headers: { "X-Api-Key": apiKey },
        signal: attemptSignal, cache: "no-store",
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { status: response.status };
      }
      const value: unknown = await response.json();
      if (!record(value).results || record(value).success === false)
        throw apiError("qloo_unavailable", "Qloo returned an unexpected response.", true);
      return { status: response.status, value: trimResponse(value) };
    }, 10_000, signal);
  } finally { releaseQlooSlot(); }
}

export async function fetchQloo(url: URL, apiKey: string, signal?: AbortSignal): Promise<unknown> {
  let quotaRetries = 0;
  let serverRetries = 0;
  let networkRetries = 0;
  while (true) {
    if (signal?.aborted) throw unavailable();
    try {
      const response = await fetchQlooAttempt(url, apiKey, signal);
      if (response.status === 429 && quotaRetries < 2) {
        const delay = [700, 1500][quotaRetries++] + Math.floor(Math.random() * 201);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (response.status >= 500 && serverRetries < 1) {
        serverRetries++;
        await new Promise((resolve) => setTimeout(resolve, 600));
        continue;
      }
      if (response.status === 429) throw apiError("quota", "Qloo request quota exceeded. Try again shortly.", true);
      if (response.status < 200 || response.status >= 300)
        throw apiError("qloo_unavailable", "Qloo could not complete the request.", response.status >= 500);
      return response.value;
    } catch (error) {
      const parsed = ApiError.safeParse(error);
      if (parsed.success) throw parsed.data;
      // a dropped connection or one slow answer is usually fine the second time
      if (networkRetries++ < 1) continue;
      throw apiError("qloo_unavailable", "Qloo is unavailable or the request timed out.", true);
    }
  }
}

/** Search and tag lookup use their own filters; insights require filter.type. */
export async function qlooGet(path: string, params: QlooParams): Promise<unknown> {
  if (!["/search", "/v2/tags", "/v2/insights", "/v2/insights/compare"].includes(path))
    throw apiError("bad_input", "Unsupported Qloo endpoint.");
  if (path === "/v2/insights" && !params["filter.type"])
    throw apiError("bad_input", "filter.type is required for insights.");
  const take = params.take;
  if (take !== undefined && (!Number.isInteger(Number(take)) || Number(take) < 1 || Number(take) > 50))
    throw apiError("bad_input", "take must be an integer between 1 and 50.");
  const apiKey = process.env.QLOO_API_KEY;
  if (!apiKey) throw apiError("qloo_unavailable", "Qloo is not configured.");
  let url: URL;
  try { url = new URL(path, process.env.QLOO_API_URL || "https://hackathon.api.qloo.com"); }
  catch { throw apiError("qloo_unavailable", "Qloo is not configured."); }
  for (const [key, value] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  const key = createHash("sha256").update(PARSER_VERSION).update(apiKey).update(url.href).digest("hex");
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    cache.delete(key);
    cache.set(key, hit);
    return structuredClone(hit.value);
  }
  cache.delete(key);
  // Charge each caller once, including coalesced waiters, before touching pending.
  // A caller-local quota rejection must neither publish nor evict a shared task.
  consumeQlooCall();
  let task = pending.get(key);
  if (!task) {
    task = withoutQlooBudget(() => bounded(signal => fetchQloo(url, apiKey, signal), 20_000).then((value) => {
      cache.set(key, { value, expires: Date.now() + TTL * 1000, fetchedAt: new Date().toISOString() });
      if (cache.size > 500) cache.delete(cache.keys().next().value!);
      return value;
    }).finally(() => {
      // Failed tasks, including upstream quota failures, are never retained.
      if (pending.get(key) === task) pending.delete(key);
    }));
    pending.set(key, task);
  }
  return structuredClone(await task);
}

/** Provenance exposes a hash of public parameters, never credentials or the private URL. */
export async function qlooRead(path: string, params: QlooParams): Promise<{ value: unknown; fetchedAt: string; requestHash: string }> {
  const value = await qlooGet(path, params);
  const url = new URL(path, process.env.QLOO_API_URL || "https://hackathon.api.qloo.com");
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "").sort(([a], [b]) => a.localeCompare(b));
  for (const [key, item] of entries) url.searchParams.set(key, String(item));
  const key = createHash("sha256").update(PARSER_VERSION).update(process.env.QLOO_API_KEY ?? "").update(url.href).digest("hex");
  return { value, fetchedAt: cache.get(key)?.fetchedAt ?? new Date().toISOString(),
    requestHash: createHash("sha256").update(JSON.stringify([path, entries])).digest("hex").slice(0, 24) };
}
