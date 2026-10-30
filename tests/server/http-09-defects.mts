import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExploreState, type ResolvedLove } from "../../src/shared/contracts";
import { NeighborhoodsResponseV2, PlacesResponseV2, PlanResponseV2, SpotResponseV2, type Constraint } from "../../src/shared/contracts-09";

const directory = join(tmpdir(), "homing-stage09-private");
const profiles = JSON.parse(readFileSync(join(directory, "profiles.json"), "utf8")) as { name: string; loves: ResolvedLove[] }[];
const report: Record<string, unknown>[] = [];
const bodies: unknown[] = [];
const headers = { "content-type": "application/json", "x-forwarded-for": "198.51.100.81" };
const stateFor = (city: string, name: string) => ExploreState.parse({ city, loves: profiles.find(p => p.name === name)!.loves, days: 1, pace: "relaxed" });
async function post(route: string, state: ExploreState, extra: Record<string, unknown> = {}) {
  const started = performance.now();
  const response = await fetch(`http://localhost:3001/api/${route}`, { method: "POST", headers, body: JSON.stringify({ responseVersion: 2, state, stateRevision: 91, constraints: [], ...extra }) });
  const body = await response.json();
  assert(response.ok, `${route}: ${response.status} ${JSON.stringify(body)}`);
  bodies.push({ route, body });
  return { body, elapsedMs: Math.round(performance.now() - started) };
}
const mode = process.argv[2] ?? "all";
if (mode === "all" || mode === "ranking") for (const city of ["Berlin", "Lisbon"]) {
  const tops = new Map<string, string[]>();
  let geometry = "";
  for (const profile of profiles) {
    const state = stateFor(city, profile.name);
    const read = await post("neighborhoods", state);
    const result = NeighborhoodsResponseV2.parse(read.body);
    assert.equal(result.meta.methodVersion, "fixed-context-per-love-heuristic-v2");
    assert(result.areas.every(a => a.metrics.percentile === null && a.metrics.rankingContext?.radiusM === 1600));
    const stamp = JSON.stringify([...result.areas].sort((a, b) => a.area.id.localeCompare(b.area.id)).map(a => [a.area, a.metrics.rankingContext?.cellCount]));
    if (geometry) assert.equal(stamp, geometry); else geometry = stamp;
    const top = result.areas.slice(0, 3), names = top.map(a => a.area.name);
    const anchorIds = top.flatMap(a => a.anchors.map(v => v.place.id));
    assert.equal(new Set(anchorIds).size, anchorIds.length);
    tops.set(profile.name, names);
    report.push({ city, profile: profile.name, top: names, elapsedMs: read.elapsedMs, manifest: result.meta.manifestVersion });
  }
  const winners = [...tops.values()].map(top => top[0]);
  assert(winners.every(name => winners.filter(other => other === name).length <= 2));
  if (city === "Berlin") {
    assert(tops.get("techno")!.slice(0, 2).some(name => /Friedrichshain|Kreuzberg|Neukölln/.test(name)));
    assert.notEqual(tops.get("reader")![0], tops.get("night owl")![0]);
  } else assert.notEqual(tops.get("reader")![0], tops.get("metal sport")![0]);
}
if (mode === "all" || mode === "venues") {
  const state = stateFor("Lisbon", "reader");
  const budget = (value: number | string): Constraint => ({ id: "budget", kind: "budget", value, strength: "hard", source: "user" });
  let selected: string | undefined;
  for (const variant of ["none", "numeric", "symbols", "legacy"] as const) {
    const read = await post("spot", variant === "legacy" ? { ...state, budget: 2 } : state, { query: "Rua da Rosa 120", constraints: variant === "numeric" ? [budget(2)] : variant === "symbols" ? [budget("$$")] : [] });
    const spot = SpotResponseV2.parse(read.body);
    assert(spot.nearby.length > 0, `${variant}: nearby must not be empty`);
    if (variant !== "none") assert(spot.nearby.every(v => v.venue.priceStatus === "unknown" || v.venue.priceStatus === "known_within"));
    selected = spot.area?.area.id;
    report.push({ variant, nearby: spot.nearby.map(v => ({ name: v.venue.place.name, price: v.venue.priceStatus })), elapsedMs: read.elapsedMs });
  }
  assert(selected);
  const constraints: Constraint[] = [budget(2), ...["bars", "museums"].map(value => ({ id: value, kind: "exclude_type" as const, value, strength: "hard" as const, source: "user" as const }))];
  const planRead = await post("plan", state, { areaIds: [selected], constraints, startHour: 14 });
  const plan = PlanResponseV2.parse(planRead.body);
  assert.equal(plan.audit.hardViolations.length, 0);
  const stops = plan.itinerary.days.flatMap(d => d.stops);
  assert(stops.length > 0);
  assert(stops.every(s => s.place.priceLevel !== undefined && s.place.priceLevel <= 2));
  assert(Object.values(plan.venueEvidence).every(v => v.insideArea));
  assert.equal(new Set(stops.map(s => s.place.name.toLowerCase())).size, stops.length);
  report.push({ visit: stops.map(s => ({ name: s.place.name, time: s.time, price: s.place.priceLevel })), unmet: plan.audit.unmet, elapsedMs: planRead.elapsedMs });
  for (const excluded of [["hotel", "adult"], ["hotel bars", "adult clubs"]]) {
    const read = await post("places", stateFor("Berlin", "techno"), { intent: "dance", constraints: excluded.map(value => ({ id: value, kind: "exclude_type", value, strength: "hard", source: "user" })) });
    const venues = PlacesResponseV2.parse(read.body);
    assert(venues.venues.length >= 2);
    report.push({ excluded, dancing: venues.venues.map(v => v.place.name), elapsedMs: read.elapsedMs });
  }
}
writeFileSync(join(directory, `d003-d014-http-${mode}.json`), JSON.stringify({ at: new Date().toISOString(), report, bodies }, null, 2));
console.log(JSON.stringify(report, null, 2));
