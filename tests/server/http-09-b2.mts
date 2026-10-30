import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExploreState } from "../../src/shared/contracts";
import { HomeResponseV2, CitiesResponseV2 } from "../../src/shared/contracts-09";
const directory = join(tmpdir(), "homing-stage09-private");
const profiles = JSON.parse(readFileSync(join(directory, "profiles.json"), "utf8"));
const state = ExploreState.parse({ city: "Lisbon", loves: profiles.find((p: { name: string }) => p.name === "indie outdoors").loves });
async function post(route: string, extra = {}) {
  const started = performance.now();
  const response = await fetch(`http://localhost:3001/api/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ responseVersion: 2, state, stateRevision: 17, constraints: [], ...extra }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${route}: ${response.status} ${JSON.stringify(body)}`);
  return { body, elapsedMs: performance.now() - started };
}
const first = await post("home", { source: { city: "Lisbon", neighborhood: "Alfama" }, lambda: 0 });
const home = HomeResponseV2.parse(first.body);
assert.equal(home.matches[0].area.area.id, home.sourceSignatureSummary.area.id);
assert.equal(home.matches[0].similarity.value, 100);
assert.equal(home.matches[0].similarity.method, "style_only_v1");
const warm = await post("home", { source: { city: "Lisbon", neighborhood: "Alfama" }, lambda: 0 });
const compare = await post("cities", { cities: ["Lisbon", "Reykjavík"], source: { city: "Berlin", neighborhood: "Kreuzberg" }, criteria: ["home_similarity"] });
const cities = CitiesResponseV2.parse(compare.body);
assert.equal(cities.meta.stateRevision, 17);
const report = { firstHomeMs: first.elapsedMs, warmHomeMs: warm.elapsedMs, comparisonMs: compare.elapsedMs, homeTop3: home.matches.slice(0, 3).map(m => ({ area: m.area.area.name, value: m.similarity.value })), cities: cities.results.map(c => ({ name: c.cityName, overlap: c.culturalOverlap, support: c.support })), recommendation: cities.recommendation, method: home.meta.methodVersion, reference: home.meta.referenceVersion };
writeFileSync(join(directory, "http-b2.json"), JSON.stringify({ report, home, cities }, null, 2));
console.log(JSON.stringify(report));
