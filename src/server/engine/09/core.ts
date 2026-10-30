import { createHash } from "node:crypto";
import { activeLoves, type ExploreState } from "@/shared/contracts";
import type { Constraint, EvidenceRef, ResultMeta, Support } from "@/shared/contracts-09";
import { qlooCacheGeneration } from "@/server/qloo/client";

// The preregistered native method failed stage-09 diversity gates (Berlin 1/6 leaders,
// Lisbon 2/6). Keep its raw data for diagnostics. The specified fallback is an
// explicitly heuristic fixed-context order, with no displayed percentile claim.
export const METHOD_VERSION = "fixed-context-per-love-heuristic-v2";
export const NATIVE_METHOD_VERSION = "native-plus-coarse-context-v2";
export const RANKING_GATE_PASSED = false;
export const MANIFEST_SCHEMA = "central-7500m-neutral-circles-context-v4";
export const CACHE_TTL = 30 * 60_000;
export const DAY_TTL = 24 * 60 * 60_000;
export const ELIGIBILITY_VERSION = "primary-club-and-culture-roles-v10";
export const AREA_CARD_VERSION = "exclusive-venue-sentence-proof-v6";
export const normalized = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
export function effectiveConstraints(state: ExploreState, constraints: Constraint[]): Constraint[] {
  return state.budget && !constraints.some(c => c.kind === "budget")
    ? [...constraints, { id: "profile:budget", kind: "budget", value: state.budget, strength: "hard", source: "user" }] : constraints;
}
export function profileHash(state: ExploreState, constraints: Constraint[] = []): string {
  const loves = (input: ExploreState["loves"]) => activeLoves(input).map(l => [l.chosen.id.toUpperCase(), l.weight]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return hash([normalized(state.city), loves(state.loves), state.companion ? loves(state.companion.loves) : null,
    state.refinements.map(t => t.id).sort(), state.discovery, state.budget, constraints.map(c => [c.id, c.kind, c.value, c.strength]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}
type CacheEntry<T> = { expires: number; promise: Promise<T> };
const processGlobal = globalThis as typeof globalThis & { __homingDerived09?: Map<string, Map<string, CacheEntry<unknown>>> };
const sharedCaches = processGlobal.__homingDerived09 ??= new Map();
/** Request-independent work is shared; failures are evicted rather than cached as empty data. */
export class DerivedCache<T> {
  private entries: Map<string, CacheEntry<T>>;
  constructor(private max = 80, private ttl = CACHE_TTL, namespace?: string) {
    this.entries = (namespace ? sharedCaches.get(namespace) : undefined) as Map<string, CacheEntry<T>> | undefined ?? new Map();
    if (namespace) sharedCaches.set(namespace, this.entries as Map<string, CacheEntry<unknown>>);
  }
  async get(key: string, compute: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
    const fullKey = `${qlooCacheGeneration()}:${ELIGIBILITY_VERSION}:${key}`;
    const old = this.entries.get(fullKey);
    if (old && old.expires > Date.now()) return { value: await old.promise, hit: true };
    const promise = compute().catch((error: unknown) => { this.entries.delete(fullKey); throw error; });
    this.entries.set(fullKey, { promise, expires: Date.now() + this.ttl });
    if (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
    return { value: await promise, hit: false };
  }
  clear(): void { this.entries.clear(); }
  delete(key: string): void { this.entries.delete(`${qlooCacheGeneration()}:${ELIGIBILITY_VERSION}:${key}`); }
}
export function evidenceRef(kind: EvidenceRef["kind"], read: { fetchedAt: string; requestHash: string }, entityIds?: string[], methodVersion?: string): EvidenceRef {
  return { id: `${kind}:${read.requestHash}`, kind, fetchedAt: read.fetchedAt, requestHash: read.requestHash, ...(entityIds ? { entityIds } : {}), ...(methodVersion ? { methodVersion } : {}) };
}
export function uniqueEvidence(evidence: EvidenceRef[]): EvidenceRef[] { return [...new Map(evidence.map(e => [e.id, e])).values()]; }
export function resultMeta(input: { state: ExploreState; stateRevision: number; constraints?: Constraint[] }, geography: { cityId: string; version: string; fetchedAt: string }, options: { method?: string; referenceVersion?: string; partial?: boolean; hit?: boolean; suffix?: unknown; dataAsOf?: string } = {}): ResultMeta {
  const profile = profileHash(input.state, input.constraints);
  const method = options.method ?? METHOD_VERSION;
  return { responseVersion: 2, analysisId: hash([profile, geography.version, method, AREA_CARD_VERSION, options.referenceVersion, options.suffix]), profileHash: profile,
    stateRevision: input.stateRevision, cityId: geography.cityId, manifestVersion: geography.version, methodVersion: method,
    ...(options.referenceVersion ? { referenceVersion: options.referenceVersion } : {}), generatedAt: new Date().toISOString(), dataAsOf: options.dataAsOf ?? geography.fetchedAt,
    cache: options.hit ? "hit" : "fresh", status: options.partial ? "partial" : "complete" };
}
export function emptySupport(notes: string[] = []): Support { return { quality: "unavailable", activeLoveWeightCovered: 0, observedAreaShare: 0, spatialBlocks: 0, eligibleVenueCount: 0, categoryCount: 0, missingSignals: [], notes }; }
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  let next = 0;
  const output: R[] = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; output[index] = await work(items[index], index); }
  }));
  return output;
}
