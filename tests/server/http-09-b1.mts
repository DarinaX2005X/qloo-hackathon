import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExploreState } from "../../src/shared/contracts";
import { NeighborhoodsResponseV2, FieldResponseV2, DecidesResponseV2, SearchResponseV2 } from "../../src/shared/contracts-09";

const directory = join(tmpdir(), "homing-stage09-private");
const profiles = JSON.parse(readFileSync(join(directory, "profiles.json"), "utf8"));
const state = ExploreState.parse({ city: "Lisbon", loves: profiles.find((p: { name: string }) => p.name === "reader").loves });
async function post(route: string, extra = {}) {
  const started = performance.now();
  const response = await fetch(`http://localhost:3001/api/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ responseVersion: 2, state, stateRevision: 9, constraints: [], ...extra }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${route}: ${response.status} ${JSON.stringify(body)}`);
  return { body, elapsedMs: performance.now() - started };
}
const both = await Promise.all([post("field"), post("neighborhoods")]);
const field = FieldResponseV2.parse(both[0].body), areas = NeighborhoodsResponseV2.parse(both[1].body);
assert.equal(field.meta.analysisId, areas.meta.analysisId);
assert.equal(areas.meta.stateRevision, 9);
assert(areas.areas.every(a => a.metrics.percentile === null));
const warm = await post("neighborhoods");
const explanation = await post("decides", { analysisId: areas.meta.analysisId, areaId: areas.areas[0].area.id });
DecidesResponseV2.parse(explanation.body);
const response = await fetch("http://localhost:3001/api/search?q=zxqv-no-such-band-92841&responseVersion=2");
const search = SearchResponseV2.parse(await response.json());
assert.equal(search.resolution, "no_match");
const report = { at: new Date().toISOString(), method: areas.meta.methodVersion, manifest: areas.meta.manifestVersion, fieldMs: both[0].elapsedMs, neighborhoodsMs: both[1].elapsedMs, warmMs: warm.elapsedMs, ablationMs: explanation.elapsedMs,
  candidates: areas.allCandidateIds.length, cells: field.field.cells.length, top3: areas.areas.slice(0, 3).map(a => ({ name: a.area.name, rank: a.metrics.rank, score: a.metrics.tasteScore, anchors: a.anchors.map(v => ({ name: v.place.name, role: v.role })) })), gibberish: search.resolution };
writeFileSync(join(directory, "http-b1.json"), JSON.stringify({ report, areas, field, explanation: explanation.body }, null, 2));
console.log(JSON.stringify(report));
