/** Live provider contract probe. Raw responses are PRIVATE, outside the repository. */
import { loadEnvFile } from "node:process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { validateCity } from "../../src/server/geo/geocode";
import { entityRef, mergeEntityRows } from "../../src/server/qloo/search";
import { record, records, resultRows, string } from "../../src/server/qloo/client";
import type { Domain } from "../../src/shared/contracts";

loadEnvFile(".env.local");
const output = process.env.HOMING_EVIDENCE_DIR || join(tmpdir(), "homing-stage09-private");
mkdirSync(output, { recursive: true });
const requested: { name: string; tastes: [string, Domain][] }[] = [
  { name: "techno", tastes: [["Ben Klock", "artist"], ["Kantine am Berghain", "place"], ["Rick Owens", "brand"]] },
  { name: "reader", tastes: [["Haruki Murakami", "author"], ["Radiohead", "artist"], ["Fleabag", "tv_show"]] },
  { name: "night owl", tastes: [["Charli XCX", "artist"], ["PEGGY GOU", "artist"], ["Euphoria", "tv_show"]] },
  { name: "pop", tastes: [["Taylor Swift", "artist"], ["Bridgerton", "tv_show"], ["Starbucks", "brand"]] },
  { name: "metal sport", tastes: [["Metallica", "artist"], ["Real Madrid CF", "brand"]] },
  { name: "indie outdoors", tastes: [["Radiohead", "artist"], ["Fleabag", "tv_show"], ["Wes Anderson", "person"], ["Patagonia", "brand"]] },
];
export const families = {
  coffee: ["urn:tag:genre:place:restaurant:coffee_shop", "urn:tag:category:place:cafe", "urn:tag:genre:place:restaurant:bakery"],
  food: ["urn:tag:category:place:restaurant"],
  nightlife: ["urn:tag:genre:place:restaurant:bar", "urn:tag:genre:place:night_club", "urn:tag:genre:place:nightclub"],
  culture: ["urn:tag:genre:place:book_store", "urn:tag:genre:place:museum", "urn:tag:genre:place:art_gallery", "urn:tag:genre:place:live_music_venue"],
};
const normalize = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
async function raw(path: string, params: Record<string, string | number>) {
  const hash = createHash("sha256").update(JSON.stringify([path, Object.entries(params).sort()])).digest("hex");
  const file = join(output, `${hash}.json`);
  if (existsSync(file)) { const saved = JSON.parse(readFileSync(file, "utf8")); if (saved.status === 200) return saved; }
  const url = new URL(path, process.env.QLOO_API_URL || "https://hackathon.api.qloo.com");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const started = performance.now();
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(url, { headers: { "X-Api-Key": process.env.QLOO_API_KEY! }, signal: AbortSignal.timeout(15000) });
    if (response.status !== 429 || attempt >= 3) break;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  const value = await response.json();
  const capture = { fetchedAt: new Date().toISOString(), path, params, status: response.status, elapsedMs: performance.now() - started, value };
  writeFileSync(file, JSON.stringify(capture));
  if (!response.ok) throw new Error(`Qloo ${response.status} for ${path}; hash ${hash}`);
  return capture;
}
async function limited<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i]); } }));
  return out;
}
const unique = [...new Map(requested.flatMap(p => p.tastes).map(t => [t.join("/"), t])).values()];
const resolved = await limited(unique, async ([query, domain]) => {
  const capture = await raw("/search", { query, types: `urn:entity:${domain}`, take: 6 });
  const candidates = mergeEntityRows(resultRows(capture.value, "entities")).flatMap(r => entityRef(r, domain as Domain) ?? []);
  const chosen = candidates.find(e => normalize(e.name) === normalize(query));
  if (!chosen) throw new Error(`Exact reference unresolved: ${query}; candidates=${candidates.map(c => c.name).join(" | ")}`);
  return { query, chosen, candidates, weight: 1 };
});
const profiles = requested.map(p => ({ name: p.name, loves: p.tastes.map(([q]) => resolved.find(r => r.query === q)!) }));
writeFileSync(join(output, "profiles.json"), JSON.stringify(profiles, null, 2));
console.log(`Frozen ${profiles.length} profiles, ${resolved.length} exact entities. Private evidence: ${output}`);
for (const city of ["Berlin", "Lisbon"]) {
  const resolvedCity = await validateCity(city);
  const location = { "filter.location": `POINT(${resolvedCity.center[0]} ${resolvedCity.center[1]})`, "filter.location.radius": 7500 };
  const heatmaps = await limited(resolved, async love => {
    const capture = await raw("/v2/insights", { "filter.type": "urn:heatmap", ...location, "signal.interests.entities": love.chosen.id, take: 50 });
    const rows = resultRows(capture.value, "heatmap");
    return { id: love.chosen.id, name: love.chosen.name, rows: rows.length, rankCount: rows.filter(r => typeof record(r.query).affinity_rank === "number").length, elapsedMs: capture.elapsedMs };
  });
  const catalogs = await limited(Object.entries(families).flatMap(([family, tags]) => [1, 2].map(page => ({ family, tags, page }))), async ({ family, tags, page }) => {
    const capture = await raw("/v2/insights", { "filter.type": "urn:entity:place", ...location, "filter.tags": tags.join(","), "operator.filter.tags": "union", take: 50, page });
    const rows = resultRows(capture.value, "entities");
    const matches = rows.filter(row => records(row.tags).some(tag => tags.includes(string(tag.id) ?? string(tag.tag_id) ?? "")));
    return { family, page, rows: rows.length, filterMatches: matches.length, elapsedMs: capture.elapsedMs, names: [...new Set(rows.map(r => string(record(r.properties).neighborhood) ?? string(record(record(r.properties).neighborhood).name) ?? string(record(record(r.properties).geocode).name)).filter(Boolean))] };
  });
  const summary = { city, resolvedCity, heatmaps, catalogs };
  writeFileSync(join(output, `probe-${city}.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
}
const radiohead = resolved.find(l => l.query === "Radiohead")!;
const fleabag = resolved.find(l => l.query === "Fleabag")!;
const joint = await raw("/v2/insights", { "filter.type": "urn:entity:place", "filter.location": "POINT(-9.1393 38.7223)", "filter.location.radius": 7500, "signal.interests.entities": [radiohead.chosen.id, fleabag.chosen.id].join(","), "feature.explainability": "true", take: 5 });
const places = resultRows(joint.value, "entities");
const fixed = await raw("/v2/insights", { "filter.type": "urn:entity:place", "filter.results.entities": places.slice(0, 3).map(p => p.entity_id).join(","), "signal.interests.entities": [radiohead.chosen.id, fleabag.chosen.id].join(","), "feature.explainability": "true", take: 5 });
console.log(JSON.stringify({ explainability: places.map(p => ({ id: p.entity_id, name: p.name, query: p.query })), fixed: resultRows(fixed.value, "entities").map(p => ({ id: p.entity_id, affinity: record(p.query).affinity })) }));
