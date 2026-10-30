import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExploreState, type ResolvedLove } from "../../src/shared/contracts";
import { AreaDecision, HomeResponseV2, NeighborhoodsResponseV2 } from "../../src/shared/contracts-09";
import { anchorOwner, leadingConnection } from "../../src/server/engine/09/area-cards";
import { haversine } from "../../src/server/engine/geo";

const directory = join(tmpdir(), "homing-stage09-private");
const profiles = JSON.parse(readFileSync(join(directory, "profiles.json"), "utf8")) as { name: string; loves: ResolvedLove[] }[];
const reports: unknown[] = [];
async function post(route: string, state: ExploreState, extra = {}) {
  const start = performance.now();
  const response = await fetch(`http://localhost:3001/api/${route}`, { method: "POST", headers: { "content-type": "application/json", connection: "close" }, signal: AbortSignal.timeout(90_000), body: JSON.stringify({ responseVersion: 2, state, stateRevision: 32, constraints: [], ...extra }) });
  const body = await response.json();
  assert(response.ok, `${route}: ${response.status} ${JSON.stringify(body)}`);
  return { body, elapsedMs: performance.now() - start };
}
function check(areas: AreaDecision[], state?: ExploreState) {
  const identities = areas.map(a => a.area), all = areas.flatMap(a => a.anchors);
  assert.equal(new Set(all.map(v => v.place.id)).size, all.length, "Repeated anchor ID");
  assert.equal(new Set(all.map(v => v.venueKey)).size, all.length, "Repeated physical anchor");
  for (const a of areas) for (const v of a.anchors) {
    assert.equal(anchorOwner(v.place, identities), a.area.id, `${v.place.name} is not nearest to ${a.area.name}`);
    assert(v.insideArea && v.evidenceIds.length && v.place.mapsUrl);
    assert(v.evidenceIds.every(id => a.evidenceIds.includes(id)), "Anchor provenance missing from card");
  }
  assert(areas.slice(0, 3).every(a => a.anchors.length >= 2), "Reference needs two distinct anchors per card");
  assert.equal(new Set(areas.slice(0, 3).map(a => a.headline)).size, 3);
  return areas.slice(0, 3).map(a => ({ area: a.area.name, rank: a.metrics.rank, headline: a.headline, tradeoff: a.tradeoff,
    leadingLove: state ? leadingConnection(a.anchors, state)?.name ?? null : null,
    anchors: a.anchors.map(v => ({ name: v.place.name, id: v.place.id, role: v.role, distanceM: Math.round(haversine(a.area.center, [v.place.lon, v.place.lat])), mapsUrl: v.place.mapsUrl })) }));
}
for (const [city, name] of [["Lisbon", "reader"], ["Berlin", "techno"]]) {
  const state = ExploreState.parse({ city, loves: profiles.find(p => p.name === name)!.loves });
  const first = await post("neighborhoods", state), result = NeighborhoodsResponseV2.parse(first.body);
  const warm = NeighborhoodsResponseV2.parse((await post("neighborhoods", state)).body);
  assert.deepEqual(result.areas, warm.areas, "Card copy/anchors changed on repeat");
  const report = { profile: `${city} ${name}`, at: new Date().toISOString(), elapsedMs: first.elapsedMs, meta: result.meta, cards: check(result.areas, state) };
  writeFileSync(join(directory, `cards-${name}.json`), JSON.stringify({ report, result }, null, 2));
  reports.push(report); console.log(JSON.stringify(report));
}
const homeState = ExploreState.parse({ city: "Lisbon", loves: [] });
const homeRun = await post("home", homeState, { source: { city: "Lisbon", neighborhood: "Alfama" }, lambda: 0 });
const home = HomeResponseV2.parse(homeRun.body);
assert.equal(home.matches[0].area.area.id, home.sourceSignatureSummary.area.id);
assert.equal(home.matches[0].similarity.value, 100);
for (const match of home.matches) for (const pair of match.counterparts) assert.equal(anchorOwner(pair.target.place, home.matches.map(m => m.area.area)), match.area.area.id);
const homeReport = { profile: "Alfama → Lisbon (Home, lambda=0)", at: new Date().toISOString(), elapsedMs: homeRun.elapsedMs, meta: home.meta, cards: check(home.matches.map(m => m.area)).map((card, i) => ({ ...card, overlap: home.matches[i].similarity.value })) };
writeFileSync(join(directory, "cards-alfama.json"), JSON.stringify({ report: homeReport, result: home }, null, 2));
reports.push(homeReport); console.log(JSON.stringify(homeReport));

const started = performance.now(), heroResponse = await fetch("http://localhost:3001/api/landing?part=hero");
assert(heroResponse.ok);
const landing = await heroResponse.json();
assert.deepEqual(Object.keys(landing), ["hero"]);
assert(landing.hero?.areas?.length === 3);
const heroAreas = landing.hero.areas.map((a: unknown) => AreaDecision.parse(a));
const heroState = ExploreState.parse({ city: landing.hero.city, loves: landing.hero.loves });
const fullHero = NeighborhoodsResponseV2.parse((await post("neighborhoods", heroState)).body);
assert.deepEqual(heroAreas, fullHero.areas.slice(0, 3), "Hero cards differ from the same profile's area response");
const heroReport = { profile: "Landing hero: Lisbon indie outdoors", at: new Date().toISOString(), elapsedMs: performance.now() - started, meta: landing.hero.meta, cards: check(fullHero.areas, heroState) };
writeFileSync(join(directory, "cards-hero.json"), JSON.stringify({ report: heroReport, result: landing }, null, 2));
reports.push(heroReport); console.log(JSON.stringify(heroReport));
writeFileSync(join(directory, "cards-followup-report.json"), JSON.stringify(reports, null, 2));
