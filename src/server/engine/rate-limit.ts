import { apiError } from "@/shared/contracts";
import { withQlooBudget } from "@/server/qloo/budget";

/** Costs cap caller cache misses, including joins of shared in-flight work.
 * Transport retries are bounded separately and do not charge any caller again.
 * A cold field is ~37 distinct calls at maximum profile size; places add up to 12 filters.
 * Plans add up to three initial pools and four recovery pools; cities/decides repeat ranking.
 */
export const QLOO_REQUEST_LIMITS: Readonly<Record<string, number>> = {
  "/api/fingerprint": 32, "/api/intake": 48, "/api/field": 64, "/api/neighborhoods": 72,
  "/api/places": 96, "/api/spot": 96, "/api/home": 160, "/api/plan": 160,
  "/api/cities": 384, "/api/decides": 384, "/api/agent": 512,
};
type Bucket = { tokens: number; at: number };
const processGlobal = globalThis as typeof globalThis & { __homingRateBuckets?: Map<string, Bucket> };
const buckets = processGlobal.__homingRateBuckets ??= new Map<string, Bucket>();
export const RATE_CAPACITY = 1536;
export const REFILL_PER_MS = 2 / 1000;
export type RateReservation = { limit: number; finish: (used: number) => void };

export function clearRateLimits(): void { buckets.clear(); }

/** Per-instance shared expensive-operation budget. The deployment proxy must sanitize IP headers. */
export function enforceRateLimit(request: Request, now = Date.now()): RateReservation | undefined {
  const cost = QLOO_REQUEST_LIMITS[new URL(request.url).pathname.replace(/\/+$/, "")];
  if (!cost) return;
  const ip = (request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown")
    .split(",")[0].trim().slice(0, 64);
  const bucket = buckets.get(ip) ?? { tokens: RATE_CAPACITY, at: now };
  bucket.tokens = Math.min(RATE_CAPACITY, bucket.tokens + Math.max(0, now - bucket.at) * REFILL_PER_MS);
  bucket.at = now;
  buckets.delete(ip);
  buckets.set(ip, bucket);
  if (buckets.size > 10000) buckets.delete(buckets.keys().next().value!);
  if (bucket.tokens < cost) throw { ...apiError("quota", "You've made several detailed requests. Please wait before trying again.", true),
    retryAfter: Math.ceil((cost - bucket.tokens) / (REFILL_PER_MS * 1000)) };
  bucket.tokens -= cost;
  let finished = false;
  return { limit: cost, finish: used => {
    if (finished) return;
    finished = true;
    // Warm/cache-only actions still pay a small route-proportional CPU/LLM charge.
    const charged = Math.min(cost, Math.max(Math.ceil(cost / 16), used));
    if (buckets.get(ip) === bucket) bucket.tokens = Math.min(RATE_CAPACITY, bucket.tokens + cost - charged);
  } };
}

export async function rateLimitedQloo<T>(request: Request, run: () => Promise<T>): Promise<T> {
  const reservation = enforceRateLimit(request);
  return reservation ? withQlooBudget(reservation.limit, run, reservation.finish) : run();
}
