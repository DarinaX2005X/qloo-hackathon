import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { ExploreState, type ResolvedLove } from "../../src/shared/contracts";
import { AnalysisRequestV2, NeighborhoodsResponseV2, FieldResponseV2, DecidesResponseV2 } from "../../src/shared/contracts-09";
import { analyzeAreas, buildNativeField, nativeCells, orderMetrics } from "../../src/server/engine/09/ranking";
import { neighborhoodsV2, fieldV2, decidesV2 } from "../../src/server/engine/09/analysis-api";
import { median, percentileRanks } from "../../src/server/engine/geo";
import { withQlooBudget } from "../../src/server/qloo/budget";
import { installPrivateCapture } from "../qloo/private-capture-09";
import { searchEntities } from "../../src/server/qloo/search";
import { METHOD_VERSION } from "../../src/server/engine/09/core";

loadEnvFile(".env.local");
const capture = installPrivateCapture(process.argv.includes("--frozen"));
const profiles = JSON.parse(readFileSync(join(capture.directory, "profiles.json"), "utf8")) as { name: string; loves: ResolvedLove[] }[];
const reports: Record<string, unknown>[] = [];
const summaries: { city: string; leaders: string[]; changedFromNeutral: number; stableSmallWeight: number; medianAbsoluteRho: number }[] = [];
function spearman(a: number[], b: number[]) {
  const x = percentileRanks(a), y = percentileRanks(b), mx = x.reduce((s, n) => s + n, 0) / x.length, my = y.reduce((s, n) => s + n, 0) / y.length;
  const numerator = x.reduce((s, n, i) => s + (n - mx) * (y[i] - my), 0);
  return numerator / Math.sqrt(x.reduce((s, n) => s + (n - mx) ** 2, 0) * y.reduce((s, n) => s + (n - my) ** 2, 0));
}
for (const city of ["Berlin", "Lisbon"]) {
  const leaders: string[] = [], rhos: number[] = []; let changedFromNeutral = 0, stableSmallWeight = 0;
  let geography = "";
  for (const profile of profiles) {
    const input = AnalysisRequestV2.parse({ state: ExploreState.parse({ city, loves: profile.loves }), stateRevision: 1 });
    const started = performance.now(); let charges = 0;
    const run = await withQlooBudget(48, () => analyzeAreas(input), used => { charges = used; });
    const analysis = run.value, elapsedMs = performance.now() - started;
    const stamp = JSON.stringify(analysis.manifest.areas.map(a => [a.identity, a.cells, a.contextCells]));
    if (geography) assert.equal(stamp, geography, "Candidate geography changed with taste"); else geography = stamp;
    assert(analysis.manifest.areas.length >= 10, "Reference requires ten named candidates");
    for (const area of analysis.areas) assert.equal(area.metrics.candidateCount, analysis.manifest.areas.length);
    const ordered = analysis.areas.map(a => a.area.id);
    const neutral = [...analysis.manifest.areas].sort((a, b) => b.neutralScore - a.neutralScore || a.identity.id.localeCompare(b.identity.id)).map(a => a.identity.id);
    if (ordered.slice(0, 3).join() !== neutral.slice(0, 3).join()) changedFromNeutral++;
    const rho = spearman(analysis.manifest.areas.map(a => analysis.areas.find(n => n.area.id === a.identity.id)!.metrics.tasteScore), analysis.manifest.areas.map(a => a.neutralScore)); rhos.push(Math.abs(rho));
    const small = analysis.yours.map((s, i) => ({ ...s, weight: i === 0 ? s.weight * .9 : s.weight }));
    const smallOrder = [...orderMetrics(analysis.manifest, small, null)].sort((a, b) => a[1].rank - b[1].rank).map(([id]) => id);
    const stable = ordered.slice(0, 3).filter(id => smallOrder.slice(0, 3).includes(id)).length;
    if (stable >= 2) stableSmallWeight++;
    const repeat = await analyzeAreas(input);
    assert.deepEqual(repeat.value.areas.map(a => a.metrics), analysis.areas.map(a => a.metrics));
    const ratio = analysis.yours.map(s => { const prior = Math.max(.02, median(s.cells.map(c => c.popularity))); const r = percentileRanks(s.cells.map(c => (c.affinity + prior) / (c.popularity + prior))); return { ...s, ranks: new Map(s.cells.map((c, i) => [c.h, r[i]])) }; });
    const ratioOrder = [...orderMetrics({ ...analysis.manifest, areas: analysis.manifest.areas.map(a => ({ ...a, contextCells: undefined })) }, ratio, null)].sort((a, b) => a[1].rank - b[1].rank).slice(0, 3).map(([id]) => analysis.areas.find(a => a.area.id === id)!.area.name);
    for (const signal of analysis.yours) {
      const rows = signal.cells.map(c => ({ location: { geohash: c.h }, query: { affinity_rank: c.value, affinity: c.affinity, popularity: c.popularity } }));
      assert.deepEqual(nativeCells([...rows, ...rows, ...rows], analysis.manifest.center, 7500), nativeCells(rows, analysis.manifest.center, 7500));
    }
    leaders.push(analysis.areas[0].area.name);
    const report = { city, profile: profile.name, method: METHOD_VERSION, elapsedMs, charges, candidates: analysis.areas.length, supported: analysis.areas.filter(a => a.metrics.support.quality === "sufficient").length, rho, stableSmallWeight: stable,
      ranking: analysis.areas.slice(0, 3).map(a => ({ name: a.area.name, score: a.metrics.tasteScore, rank: a.metrics.rank, percentile: a.metrics.percentile, support: a.metrics.support, anchors: a.anchors.map(v => ({ name: v.place.name, role: v.role, connections: v.connections.length })) })),
      fixedRatioDiagnostic: ratioOrder, neutral: neutral.slice(0, 3).map(id => analysis.areas.find(a => a.area.id === id)!.area.name), manifestVersion: analysis.manifest.version };
    reports.push(report); console.log(JSON.stringify(report));
    // Validate actual endpoint adapters, cached; timing is explicitly warm.
    NeighborhoodsResponseV2.parse(await neighborhoodsV2(input)); FieldResponseV2.parse(await fieldV2(input)); DecidesResponseV2.parse(await decidesV2(input));
  }
  const summary = { city, leaders, changedFromNeutral, stableSmallWeight, medianAbsoluteRho: median(rhos) }; summaries.push(summary); console.log(JSON.stringify(summary));
}
const artists = await Promise.all(["Radiohead", "Aphex Twin"].map(async query => ({ query, chosen: (await searchEntities(query, "artist"))[0], candidates: [], weight: 1 })));
const weights = await analyzeAreas(AnalysisRequestV2.parse({ state: ExploreState.parse({ city: "Berlin", loves: artists }), stateRevision: 1 }));
const changed = buildNativeField(weights.value.manifest, weights.value.yours.map((s, i) => ({ ...s, weight: i ? .05 : 1 })), null);
const maxCellDelta = Math.max(...weights.value.field.cells.map((c, i) => Math.abs(c.you - changed.cells[i].you)));
assert(maxCellDelta >= .1);
const summary = { summaries, maxCellDelta, capture: capture.counts(), frozenReplay: process.argv.includes("--frozen") };
writeFileSync(join(capture.directory, process.argv.includes("--defects") ? "d003-final-reference.json" : "b1-final-reference.json"), JSON.stringify({ summary, reports }, null, 2));
if (process.argv.includes("--defects")) {
  for (const city of summaries) {
    const counts = city.leaders.map(name => city.leaders.filter(other => other === name).length);
    assert(Math.max(...counts) <= 2, `${city.city}: an area wins more than two profiles`);
    assert(new Set(city.leaders).size >= 4, `${city.city}: fewer than four different leaders`);
  }
  const rows = reports as { city: string; profile: string; ranking: { name: string }[] }[];
  const row = (city: string, profile: string) => rows.find(r => r.city === city && r.profile === profile)!;
  assert(row("Berlin", "techno").ranking.slice(0, 2).some(r => /Friedrichshain|Kreuzberg|Neukölln/.test(r.name)));
  assert.notEqual(row("Berlin", "reader").ranking[0].name, row("Berlin", "night owl").ranking[0].name);
  assert.notEqual(row("Lisbon", "reader").ranking[0].name, row("Lisbon", "metal sport").ranking[0].name);
}
console.log(JSON.stringify(summary));
capture.restore();
