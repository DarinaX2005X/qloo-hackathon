import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExploreState } from "../../src/shared/contracts";
import { NeighborhoodsResponseV2, PlacesResponseV2, PlanResponseV2, SpotResponseV2 } from "../../src/shared/contracts-09";
const directory = join(tmpdir(), "homing-stage09-private");
const profiles = JSON.parse(readFileSync(join(directory, "profiles.json"), "utf8"));
const state = ExploreState.parse({ city: "Lisbon", loves: profiles.find((p: { name: string }) => p.name === "reader").loves, days: 1 });
const constraints = [{ id: "no-bars", kind: "exclude_type", value: "bars", strength: "hard", source: "user" }, { id: "no-museums", kind: "exclude_type", value: "museums", strength: "hard", source: "user" }, { id: "budget", kind: "budget", value: 2, strength: "hard", source: "user" }];
async function post(route: string, extra = {}) {
  const started = performance.now();
  const response = await fetch(`http://localhost:3001/api/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ responseVersion: 2, state, stateRevision: 24, constraints, ...extra }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${route}: ${response.status} ${JSON.stringify(body)}`);
  return { body, elapsedMs: performance.now() - started };
}
const areas = NeighborhoodsResponseV2.parse((await post("neighborhoods")).body);
const selected = areas.areas[0];
const spotRead = await post("spot", { query: "Rua da Rosa 120", areaId: selected.area.id });
const spot = SpotResponseV2.parse(spotRead.body);
assert.equal(spot.meta.stateRevision, 24);
const actual = spot.area?.area.id ?? selected.area.id;
const venueRead = await post("places", { areaId: actual, intent: "coffee" });
const venues = PlacesResponseV2.parse(venueRead.body);
const planRead = await post("plan", { areaIds: [actual] });
const plan = PlanResponseV2.parse(planRead.body);
assert.equal(plan.audit.hardViolations.length, 0);
assert(plan.itinerary.days.flatMap(d => d.stops).every(s => s.place.priceLevel !== undefined && s.place.priceLevel <= 2));
const report = { addressMs: spotRead.elapsedMs, placesMs: venueRead.elapsedMs, planMs: planRead.elapsedMs,
  address: { label: spot.label, precision: spot.geocodeQuality, area: spot.area?.area.name, outsideSelectedArea: spot.outsideSelectedArea, nearby: spot.nearby.length }, coffee: venues.venues.slice(0, 5).map(v => v.place.name),
  visit: plan.itinerary.days.map(d => ({ area: d.neighborhood, stops: d.stops.map(s => ({ name: s.place.name, time: s.time, price: s.place.priceLevel })), missing: d.missing })), unmet: plan.audit.unmet, recovery: plan.recoveryLog };
writeFileSync(join(directory, "http-b3.json"), JSON.stringify({ report, spot, venues, plan }, null, 2)); console.log(JSON.stringify(report));
