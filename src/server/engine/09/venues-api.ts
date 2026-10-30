import { activeLoves, apiError, type ExploreState } from "@/shared/contracts";
import type { AreaIdentity, Constraint, EvidenceRef, PlaceIntentV2, PlacesRequestV2, PlacesResponseV2, PlaceV2, VenueEvidence } from "@/shared/contracts-09";
import { qlooRead, record, records, resultRows, string, type QlooRecord } from "@/server/qloo/client";
import { haversine, percentileRanks } from "../geo";
import { DerivedCache, effectiveConstraints, evidenceRef, hash, mapLimit, normalized, resultMeta, uniqueEvidence } from "./core";
import { brandKey, dedupePlaces, rowPlace, venueEligibility, venueKey } from "./eligibility";
import { cityManifest, NEUTRAL_FAMILIES, type CityManifest } from "./manifest";
import { pointInArea } from "./geometry";

export const VENUE_METHOD = "role-first-budget-role-recovery-v6";
const pools = new DerivedCache<VenuePool>(100, undefined, VENUE_METHOD);
export const ROLE_TAGS: Record<PlaceIntentV2, string[]> = {
  coffee: [...NEUTRAL_FAMILIES.coffee], food: [...NEUTRAL_FAMILIES.food], bar: ["urn:tag:genre:place:restaurant:bar", "urn:tag:genre:place:pub"],
  dance: ["urn:tag:genre:place:night_club", "urn:tag:genre:place:nightclub"],
  concert: ["urn:tag:genre:place:live_music_venue", "urn:tag:genre:place:concert_hall", "urn:tag:genre:place:music_club"],
  live_music: ["urn:tag:genre:place:live_music_venue", "urn:tag:genre:place:concert_hall", "urn:tag:genre:place:music_club"],
  culture: [...NEUTRAL_FAMILIES.culture], daily_life: Object.values(NEUTRAL_FAMILIES).flat(),
};
export type VenuePool = { venues: VenueEvidence[]; rejectedByReason: Record<string, number>; unmet: string[]; evidence: EvidenceRef[]; partial: boolean };
export { effectiveConstraints } from "./core";
export function musicIntent(intent: PlaceIntentV2): boolean { return intent === "dance" || intent === "concert" || intent === "live_music"; }
export function venueSignals(state: ExploreState, intent: PlaceIntentV2) {
  const loves = activeLoves([...state.loves, ...(state.companion?.loves ?? [])]);
  const selected = musicIntent(intent) ? loves.filter(l => ["artist", "album", "track"].includes(l.chosen.domain)) : loves;
  const byId = new Map<string, typeof selected[number]>();
  for (const love of selected) {
    const old = byId.get(love.chosen.id);
    byId.set(love.chosen.id, old ? { ...old, weight: old.weight + love.weight } : love);
  }
  return [...byId.values()].sort((a, b) => a.chosen.id.localeCompare(b.chosen.id));
}
export function connectionsFromRow(row: QlooRecord, allowedIds: string[], evidenceIds: string[]): VenueEvidence["connections"] {
  const allowed = new Set(allowedIds.map(id => id.toUpperCase()));
  const placeId = string(row.entity_id);
  if (!placeId) return [];
  return records(record(record(row.query).explainability)["signal.interests.entities"]).flatMap(item => {
    const loveId = string(item.entity_id), score = item.score;
    return loveId && allowed.has(loveId.toUpperCase()) && typeof score === "number" && score >= 0 && score <= 1
      ? [{ placeId, loveId, providerContribution: score, sharedTagIds: [], explanationKind: "provider" as const, evidenceIds }] : [];
  });
}
export function venueEvidence(place: PlaceV2, input: { intent: PlaceIntentV2; constraints: Constraint[]; center: [number, number]; radiusM: number; excludeIds?: string[]; area?: AreaIdentity; evidence: EvidenceRef[]; connections?: VenueEvidence["connections"]; deferHours?: boolean }): VenueEvidence | null {
  const eligible = venueEligibility(place, input.intent, input.constraints, input);
  if (!eligible.allowed || !eligible.role) return null;
  const insideArea = !input.area || pointInArea([place.lon, place.lat], input.area);
  return { place, role: eligible.role, venueKey: venueKey(place), brandKey: brandKey(place), insideArea,
    eligibility: "eligible", priceStatus: eligible.priceStatus, hoursStatus: eligible.hoursStatus, connections: input.connections ?? [],
    limitations: [...eligible.limitations, ...(!insideArea ? ["This place is outside the selected 650 m area."] : [])], evidenceIds: input.evidence.map(e => e.id) };
}
function preferenceCoverage(place: PlaceV2, constraints: Constraint[]): number {
  const preferences = constraints.filter(c => c.strength === "soft");
  if (!preferences.length) return 0;
  const text = normalized((place.tags ?? []).flatMap(t => [t.id, t.name]).join(" "));
  return preferences.filter(c => c.kind === "budget" ? place.priceLevel !== undefined && place.priceLevel <= Number(c.value)
    : ["ambience", "intent", "dietary"].includes(c.kind) && text.includes(normalized(String(c.value)))).length / preferences.length;
}
export async function loadVenuePool(manifest: CityManifest, state: ExploreState, options: { intent: PlaceIntentV2; constraints: Constraint[]; center: [number, number]; radiusM: number; area?: AreaIdentity; excludeIds?: string[]; temporaryTagIds?: string[]; fixedIds?: string[]; deferHours?: boolean }): Promise<VenuePool> {
  const constraints = effectiveConstraints(state, options.constraints);
  const loves = venueSignals(state, options.intent), ids = loves.map(l => l.chosen.id);
  const tags = [...new Set(options.temporaryTagIds ?? [])];
  if (musicIntent(options.intent) && !ids.length && !tags.length) return { venues: [], rejectedByReason: {}, unmet: ["Choose a music love or a music genre to find venues for this request."], evidence: [], partial: true };
  const key = hash([manifest.version, loves.map(l => [l.chosen.id, l.weight]), state.refinements.map(t => t.id).sort(), constraints, options]);
  const loaded = await pools.get(key, async () => {
    const evidence: EvidenceRef[] = [], unmet: string[] = [], rejectedByReason: Record<string, number> = {};
    const reject = (reason: string) => { rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1; };
    let partial = false;
    const query = { "filter.type": "urn:entity:place",
        ...(options.fixedIds?.length ? { "filter.results.entities": [...new Set(options.fixedIds)].join(",") } : { "filter.location": `POINT(${options.center[0]} ${options.center[1]})`, "filter.location.radius": options.radiusM, "filter.tags": ROLE_TAGS[options.intent].join(","), "operator.filter.tags": "union" }),
        ...(ids.length ? { "signal.interests.entities": ids.join(",") } : {}), ...(tags.length ? { "signal.interests.tags": tags.join(",") } : {}), "feature.explainability": "true", take: 50 };
    const budgets = constraints.filter(c => c.kind === "budget" && c.strength === "hard").map(c => typeof c.value === "string" && /^\${1,4}$/.test(c.value) ? c.value.length : Number(c.value)).filter(n => Number.isInteger(n) && n >= 1 && n <= 4);
    // Taste-first retrieval can fill all 50 slots with expensive venues. Fetch a
    // second bounded pool using the provider's price filter, in parallel. Keep
    // unknown-price discovery from the first pool, then audit every merged row.
    // Fixed-ID calls are rechecks; they must never bring in replacement venues.
    const queries = [query, ...(!options.fixedIds?.length && budgets.length ? [{ ...query, "filter.price_level.max": Math.min(...budgets) }] : [])];
    const reads = await Promise.allSettled(queries.map(params => qlooRead("/v2/insights", params)));
    const rows = reads.flatMap((read, index) => {
      if (read.status === "rejected") {
        if (reads.every(result => result.status === "rejected")) throw read.reason;
        partial = true; unmet.push(index ? "The additional search for known prices was unavailable. Retry to check more affordable places." : "The full taste-based place search was unavailable; this list uses the budget-filtered candidates.");
        return [];
      }
      const found = resultRows(read.value.value, "entities");
      evidence.push(evidenceRef("qloo_entity", read.value, found.flatMap(r => string(r.entity_id) ?? []), VENUE_METHOD), evidenceRef("qloo_explainability", read.value, ids, index ? "budget-filtered-joint-query" : "joint-query"));
      return found;
    });
    const dedupedRows = [...new Map(rows.map(row => [string(row.entity_id), row])).values()];
    const checkRow = (row: QlooRecord) => {
      const place = rowPlace(row);
      if (!place) { reject("closed_or_invalid"); return []; }
      if (options.fixedIds?.length && !options.fixedIds.includes(place.id)) { reject("unexpected_id"); return []; }
      const gate = venueEligibility(place, options.intent, constraints, options);
      if (!gate.allowed) { gate.reasons.forEach(reject); return []; }
      return [{ row, place, role: gate.role }];
    };
    const eligible = dedupedRows.flatMap(checkRow);
    // A broad union can still be dominated by restaurants/bars after the price
    // filter. Recover at most two missing everyday roles without widening the
    // user's area or relaxing any exclusion. Every added venue uses the same gate.
    if (!partial && !options.fixedIds?.length && options.intent === "daily_life" && constraints.some(c => c.strength === "hard") && eligible.length < 6) {
      const missing = (["coffee", "food", "culture"] as const).filter(role => !eligible.some(item => item.role === role)).slice(0, 2);
      const recovered = await Promise.allSettled(missing.map(role => qlooRead("/v2/insights", { ...query,
        "filter.tags": ROLE_TAGS[role].join(","), ...(budgets.length ? { "filter.price_level.max": Math.min(...budgets) } : {}), take: 25 })));
      const seen = new Set(dedupedRows.map(row => string(row.entity_id)));
      recovered.forEach((read, index) => {
        if (read.status === "rejected") { partial = true; unmet.push(`The additional ${missing[index]} search was unavailable. Retry to check this part of daily life.`); return; }
        const found = resultRows(read.value.value, "entities");
        evidence.push(evidenceRef("qloo_entity", read.value, found.flatMap(r => string(r.entity_id) ?? []), VENUE_METHOD), evidenceRef("qloo_explainability", read.value, ids, `missing-${missing[index]}-joint-query`));
        for (const row of found) {
          const id = string(row.entity_id); if (seen.has(id)) continue;
          seen.add(id); rows.push(row); eligible.push(...checkRow(row));
        }
      });
    }
    const unique = new Set(dedupePlaces(eligible.map(p => p.place)).map(p => p.id));
    const candidates = eligible.filter(p => unique.has(p.place.id)).sort((a, b) => b.place.affinity - a.place.affinity || a.place.id.localeCompare(b.place.id)).slice(0, 20);
    const localRanks = new Map<string, number>();
    const rerankEvidence = new Map<string, string[]>();
    // Joint provider affinity is used only for equal weights. Nonuniform weights
    // are evaluated on exactly the same <=20 IDs, with a per-love local midrank.
    const unevenWeights = loves.some(l => Math.abs(l.weight - loves[0].weight) > 1e-6);
    if (unevenWeights && candidates.length) {
      const matrix = await mapLimit(loves, 2, async love => {
        try {
          const read = await qlooRead("/v2/insights", { "filter.type": "urn:entity:place", "filter.results.entities": candidates.map(p => p.place.id).join(","), "signal.interests.entities": love.chosen.id, "feature.explainability": "true", take: candidates.length });
          const values = resultRows(read.value, "entities").filter(row => candidates.some(p => p.place.id === row.entity_id) && typeof record(row.query).affinity === "number");
          const ranks = percentileRanks(values.map(row => Number(record(row.query).affinity)));
          const ref = evidenceRef("qloo_entity", read, candidates.map(c => c.place.id), "per-love-fixed-pool-midrank-v1"); evidence.push(ref); rerankEvidence.set(love.chosen.id, [ref.id]);
          return { love, values: new Map(values.map((row, index) => [String(row.entity_id), ranks[index]])) };
        } catch { partial = true; return null; }
      });
      const valid = matrix.filter((m): m is NonNullable<typeof m> => !!m);
      if (valid.length !== loves.length) unmet.push("Some weighted taste signals could not be checked for this place list.");
      const total = valid.reduce((s, v) => s + v.love.weight, 0);
      for (const { place } of candidates) if (total) localRanks.set(place.id, valid.reduce((s, v) => s + v.love.weight * (v.values.get(place.id) ?? .5), 0) / total);
    }
    const jointRanks = percentileRanks(candidates.map(c => c.place.affinity));
    const scored = candidates.flatMap(({ row, place }, i) => {
      const connections = unevenWeights && localRanks.has(place.id) ? loves.filter(l => rerankEvidence.has(l.chosen.id)).map(l => ({ placeId: place.id, loveId: l.chosen.id, sharedTagIds: [], explanationKind: "local_weighted_rerank" as const, evidenceIds: rerankEvidence.get(l.chosen.id)! })) : connectionsFromRow(row, ids, evidence.filter(e => e.kind === "qloo_explainability").map(e => e.id));
      const venue = venueEvidence(place, { ...options, constraints, evidence, connections });
      if (!venue) return [];
      const practical = (Number(place.priceLevel !== undefined) + Number(!!place.hours)) / 2;
      const taste = localRanks.get(place.id) ?? jointRanks[i];
      return [{ venue, utility: .75 * taste + .15 * preferenceCoverage(place, constraints) + .10 * practical, distance: haversine(options.center, [place.lon, place.lat]) }];
    }).sort((a, b) => Math.abs(a.utility - b.utility) < .02 ? a.distance - b.distance || a.venue.place.id.localeCompare(b.venue.place.id) : b.utility - a.utility);
    const venues = scored.map(s => s.venue);
    if (!venues.length && !unmet.length) unmet.push(rows.length
      ? `None of ${rows.length} returned places passed the requested role and constraints in this search area.`
      : "The provider returned no candidates for this query. Try a different style or retry the search.");
    return { venues, rejectedByReason, unmet, evidence: uniqueEvidence(evidence), partial: partial || !venues.length };
  });
  if (loaded.value.partial) pools.delete(key);
  return structuredClone(loaded.value);
}
export async function placesV2(input: PlacesRequestV2): Promise<PlacesResponseV2> {
  const { value: manifest } = await cityManifest(input.state.city);
  const area = input.areaId ? manifest.areas.find(a => a.identity.id === input.areaId) : undefined;
  if (input.areaId && !area) throw apiError("not_found", "This area is no longer in the city catalog. Select an area again.");
  const pool = await loadVenuePool(manifest, input.state, { intent: input.intent, constraints: input.constraints, center: area?.identity.center ?? manifest.center, radiusM: input.radiusM ?? (area ? 650 : manifest.radiusM), area: area?.identity, excludeIds: input.excludeIds, temporaryTagIds: input.temporaryTagIds });
  return { meta: resultMeta(input, manifest, { method: VENUE_METHOD, partial: pool.partial, suffix: [input.areaId, input.intent, input.radiusM, input.excludeIds, input.temporaryTagIds], dataAsOf: pool.evidence.map(e => e.fetchedAt).sort()[0] }), venues: pool.venues, rejectedByReason: pool.rejectedByReason, unmet: pool.unmet, evidence: pool.evidence };
}
