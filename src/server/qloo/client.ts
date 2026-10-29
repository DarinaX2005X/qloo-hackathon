import { createHash } from "node:crypto";
import { ApiError, apiError } from "@/shared/contracts";

export type QlooParams = Record<string, string | number | undefined>;
export type QlooRecord = Record<string, unknown>;
type QlooRuntime = {
  cache: Map<string, { value: unknown; expires: number }>;
  pending: Map<string, Promise<unknown>>;
  active: number;
  queue: (() => void)[];
};
const processGlobal = globalThis as typeof globalThis & { __homingQlooRuntime?: QlooRuntime };
const runtime = processGlobal.__homingQlooRuntime ??= { cache: new Map(), pending: new Map(), active: 0, queue: [] };
const { cache, pending } = runtime;
const TTL = 604800;

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

/** Keep only fields used by the engine before retaining a response in memory. */
export function trimResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(trimResponse);
  if (!value || typeof value !== "object") return value;
  const allowed = new Set([
    "results", "entities", "tags", "heatmap", "entity_id", "id", "tag_id", "name", "type", "types", "subtype",
    "properties", "location", "latitude", "longitude", "lat", "lon", "geohash", "query", "popularity", "affinity",
    "image", "images", "url", "short_description", "neighborhood", "geocode", "hours", "price_level", "address",
    "keywords", "count", "parents", "is_closed", "primary_genre", "opens", "closes", "closed",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ]);
  return Object.fromEntries(Object.entries(record(value)).filter(([key]) =>
    allowed.has(key) || /^entity_\w+_affinity$/.test(key),
  ).map(([key, item]) => [key, trimResponse(item)]));
}

export function clearQlooCache(): void {
  cache.clear();
}

export async function acquireQlooSlot(): Promise<void> {
  if (runtime.active < 4) { runtime.active++; return; }
  await new Promise<void>((resolve) => { runtime.queue.push(resolve); });
}

export function releaseQlooSlot(): void {
  const next = runtime.queue.shift();
  if (next) next(); // Transfer the occupied slot to the oldest waiter.
  else runtime.active--;
}

export async function fetchQlooAttempt(url: URL, apiKey: string): Promise<{ status: number; value?: unknown }> {
  await acquireQlooSlot();
  try {
    const response = await fetch(url, {
      method: "GET", headers: { "X-Api-Key": apiKey },
      signal: AbortSignal.timeout(9000), next: { revalidate: TTL },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status };
    }
    const value: unknown = await response.json();
    if (!record(value).results || record(value).success === false)
      throw apiError("qloo_unavailable", "Qloo returned an unexpected response.", true);
    return { status: response.status, value: trimResponse(value) };
  } finally { releaseQlooSlot(); }
}

export async function fetchQloo(url: URL, apiKey: string): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchQlooAttempt(url, apiKey);
      if (response.status === 429 && attempt < 2) {
        const delay = [700, 1500][attempt] + Math.floor(Math.random() * 201);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (response.status >= 500 && attempt === 0) {
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
      throw apiError("qloo_unavailable", "Qloo is unavailable or the request timed out.", true);
    }
  }
  throw apiError("qloo_unavailable", "Qloo is unavailable.", true);
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
  const key = createHash("sha256").update(apiKey).update(url.href).digest("hex");
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    cache.delete(key);
    cache.set(key, hit);
    return structuredClone(hit.value);
  }
  cache.delete(key);
  let task = pending.get(key);
  if (!task) {
    task = fetchQloo(url, apiKey).then((value) => {
      cache.set(key, { value, expires: Date.now() + TTL * 1000 });
      if (cache.size > 500) cache.delete(cache.keys().next().value!);
      return value;
    }).finally(() => { pending.delete(key); });
    pending.set(key, task);
  }
  return structuredClone(await task);
}
