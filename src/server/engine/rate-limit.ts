import { apiError } from "@/shared/contracts";

const COSTS: Record<string, number> = { "/api/agent": 2, "/api/cities": 2, "/api/home": 2, "/api/decides": 2 };
type Bucket = { tokens: number; at: number };
const buckets = new Map<string, Bucket>();
export const RATE_CAPACITY = 24;
const REFILL_PER_MS = 1 / 5000;

export function clearRateLimits(): void { buckets.clear(); }

/** Per-instance shared expensive-operation budget. The deployment proxy must sanitize IP headers. */
export function enforceRateLimit(request: Request, now = Date.now()): void {
  const cost = COSTS[new URL(request.url).pathname];
  if (!cost) return;
  const ip = (request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown")
    .split(",")[0].trim().slice(0, 64);
  const prior = buckets.get(ip);
  const tokens = Math.min(RATE_CAPACITY, (prior?.tokens ?? RATE_CAPACITY) + (prior ? Math.max(0, now - prior.at) * REFILL_PER_MS : 0));
  buckets.delete(ip);
  buckets.set(ip, { tokens: Math.max(0, tokens - (tokens >= cost ? cost : 0)), at: now });
  if (buckets.size > 10000) buckets.delete(buckets.keys().next().value!);
  if (tokens < cost) throw apiError("quota", "You've made several detailed requests. Please wait a few seconds, then try again.", true);
}
