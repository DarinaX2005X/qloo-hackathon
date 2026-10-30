import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExploreState } from "../../src/shared/contracts";
import { AnalysisRequestV2, FieldResponseV2, NeighborhoodsResponseV2 } from "../../src/shared/contracts-09";
import { fieldV2, neighborhoodsV2 } from "../../src/server/engine/09/analysis-api";
import { withQlooBudget } from "../../src/server/qloo/budget";
import { installPrivateCapture } from "../qloo/private-capture-09";

loadEnvFile(".env.local");
const capture = installPrivateCapture(process.argv.includes("--frozen"));
const profiles = JSON.parse(readFileSync(join(capture.directory, "profiles.json"), "utf8"));
const loves = profiles.find((p: { name: string }) => p.name === "indie outdoors").loves;
const reports = [];
for (const city of ["Amsterdam", "Montréal"]) {
  const state = ExploreState.parse({ city, loves }), input = AnalysisRequestV2.parse({ state, stateRevision: 41 });
  let coldCharges = 0, warmCharges = 0;
  const started = performance.now();
  const [field, areas] = await withQlooBudget(72, async () => Promise.all([fieldV2(input).then(v => FieldResponseV2.parse(v)), neighborhoodsV2(input).then(v => NeighborhoodsResponseV2.parse(v))]), n => { coldCharges = n; });
  const coldMs = performance.now() - started;
  assert.equal(field.meta.analysisId, areas.meta.analysisId);
  assert.equal(field.meta.manifestVersion, areas.meta.manifestVersion);
  assert(areas.areas.length > 0); assert(areas.areas.every(a => a.metrics.percentile === null));
  const warmStart = performance.now();
  const warm = await withQlooBudget(72, () => neighborhoodsV2({ ...input, stateRevision: 42 }), n => { warmCharges = n; });
  assert.equal(warm.meta.stateRevision, 42); assert.equal(warm.meta.analysisId, areas.meta.analysisId); assert.equal(warmCharges, 0);
  const report = { city, coldMs, coldCharges, warmMs: performance.now() - warmStart, warmCharges, areas: areas.areas.length, cells: field.field.cells.length, support: field.support.quality, method: field.meta.methodVersion, manifest: field.meta.manifestVersion, top3: areas.areas.slice(0, 3).map(a => ({ name: a.area.name, rank: a.metrics.rank, support: a.metrics.support.quality, anchors: a.anchors.map(v => v.place.name) })) };
  console.log(JSON.stringify(report)); reports.push(report);
}
writeFileSync(join(capture.directory, "b5-new-cities.json"), JSON.stringify({ reports, capture: capture.counts() }, null, 2));
capture.restore();
