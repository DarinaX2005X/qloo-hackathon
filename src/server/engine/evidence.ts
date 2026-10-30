import { createHash } from "node:crypto";
import type { ExploreState, Fingerprint, ResolvedLove } from "@/shared/contracts";
import { qlooCacheGeneration, qlooGet, record, resultRows, string, unit, type QlooRecord } from "@/server/qloo/client";
import { coordinates } from "./geo";
import { buildFingerprint } from "./fingerprint";
import { signals } from "./signals";
import { cityCenter } from "./city";
import { mean } from "./geo";

/** No taste affinity, count bonus or rank remapping: the reproducible pitch control. */
export function popularityNeighborhoods(rows: QlooRecord[], city: string): { name: string; score: number }[] {
  const groups = new Map<string, Map<string, number>>();
  const normalize = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
  for (const row of rows) {
    const props = record(row.properties);
    const name = string(props.neighborhood) ?? string(record(props.neighborhood).name) ?? string(record(props.geocode).name);
    const id = string(row.entity_id);
    if (!id || !name || props.is_closed === true || normalize(name) === normalize(city.split(",")[0])) continue;
    const group = groups.get(name) ?? new Map<string, number>();
    group.set(id, unit(row.popularity)); groups.set(name, group);
  }
  return [...groups].filter(([, places]) => places.size >= 3).map(([name, places]) => ({ name, score: mean([...places.values()]) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 3);
}

export type CityEvidence = { yours: QlooRecord[]; theirs?: QlooRecord[]; fingerprint: Fingerprint };
const evidenceCache = new Map<string, { expires: number; promise: Promise<CityEvidence> }>();

export function clearEvidenceCache(): void { evidenceCache.clear(); }

export async function cityPlaces(state: ExploreState, loves: ResolvedLove[] = state.loves): Promise<QlooRecord[]> {
  // The same circle as the heatmap, so places and the field describe one area whatever the city is called.
  const center = await cityCenter(state.city);
  const pages = await Promise.all([1, 2, 3].map(async (page) => resultRows(await qlooGet("/v2/insights", {
    "filter.type": "urn:entity:place", "filter.location": `POINT(${center[0]} ${center[1]})`, "filter.location.radius": 15000,
    ...signals(loves, state.refinements), take: 50, page,
  }), "entities")));
  const found = new Map<string, QlooRecord>();
  for (const row of pages.flat()) {
    const id = string(row.entity_id);
    if (id && coordinates(row) && record(row.properties).is_closed !== true && !found.has(id)) found.set(id, row);
  }
  return [...found.values()].slice(0, 150);
}

export async function getCityEvidence(state: ExploreState): Promise<CityEvidence> {
  const key = createHash("sha256").update(JSON.stringify([qlooCacheGeneration(), process.env.QLOO_API_KEY,
    state.city, signals(state.loves, state.refinements), state.companion ? signals(state.companion.loves) : null])).digest("hex");
  const cached = evidenceCache.get(key);
  if (cached && cached.expires > Date.now()) {
    evidenceCache.delete(key);
    evidenceCache.set(key, cached);
    return structuredClone(await cached.promise);
  }
  const promise = Promise.all([cityPlaces(state), state.companion ? cityPlaces(state, state.companion.loves) : undefined, buildFingerprint(state)])
    .then(([yours, theirs, fingerprint]) => ({ yours, theirs, fingerprint }))
    .catch((error: unknown) => { evidenceCache.delete(key); throw error; });
  evidenceCache.set(key, { expires: Date.now() + 300000, promise });
  if (evidenceCache.size > 100) evidenceCache.delete(evidenceCache.keys().next().value!);
  return structuredClone(await promise);
}
