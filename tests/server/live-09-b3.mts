import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExploreState } from "../../src/shared/contracts";
import { PlacesRequestV2, PlacesResponseV2, PlanRequestV2, PlanResponseV2, SpotRequestV2, SpotResponseV2, type Constraint } from "../../src/shared/contracts-09";
import { placesV2 } from "../../src/server/engine/09/venues-api";
import { planV2 } from "../../src/server/engine/09/visit-api";
import { spotV2 } from "../../src/server/engine/09/address-api";
import { cityManifest } from "../../src/server/engine/09/manifest";
import { rolesForPlace, rowPlace, venueEligibility } from "../../src/server/engine/09/eligibility";
import { qlooRead, resultRows } from "../../src/server/qloo/client";
import { searchEntities, searchPlaceTags } from "../../src/server/qloo/search";
import { withQlooBudget } from "../../src/server/qloo/budget";
import { installPrivateCapture } from "../qloo/private-capture-09";
loadEnvFile(".env.local");
const capture = installPrivateCapture(process.argv.includes("--frozen"));
const profiles = JSON.parse(readFileSync(join(capture.directory, "profiles.json"), "utf8"));
const techno = profiles.find((p: { name: string }) => p.name === "techno");
const reports = [];
for (const city of ["Berlin", "Lisbon"]) for (const intent of ["dance", "coffee"] as const) {
  const input = PlacesRequestV2.parse({ state: ExploreState.parse({ city, loves: techno.loves }), stateRevision: 21, intent });
  let charges = 0; const started = performance.now();
  const result = PlacesResponseV2.parse(await withQlooBudget(96, () => placesV2(input), n => { charges = n; }));
  for (const venue of result.venues) assert(venueEligibility(venue.place, intent).allowed);
  const report = { city, intent, elapsedMs: performance.now() - started, charges, count: result.venues.length, unmet: result.unmet, rejected: result.rejectedByReason, top5: result.venues.slice(0, 5).map(v => ({ name: v.place.name, id: v.place.id, primary: v.place.primaryGenre, role: v.role, links: v.connections.length, hours: v.hoursStatus, musicTags: v.place.tags?.filter(t => /techno|electronic/.test(`${t.id} ${t.name}`)).map(t => t.name) })) };
  reports.push(report); console.log(JSON.stringify(report));
}
const controls = [];
for (const name of ["Elefante Branco", "Continente", "Stone's Café", "The Waterhole", "Berghain", "Tresor", "://about blank", "Lux Frágil", "Ministerium"]) {
  const found = await searchEntities(name, "place");
  if (!found.length) { controls.push({ query: name, status: "no_match" }); continue; }
  const read = await qlooRead("/v2/insights", { "filter.type": "urn:entity:place", "filter.results.entities": found.slice(0, 2).map(e => e.id).join(","), take: 2 });
  const noBars: Constraint[] = [{ id: "no-bars", kind: "exclude_type", value: "bars", strength: "hard", source: "user" }];
  controls.push({ query: name, status: "found", candidates: resultRows(read.value, "entities").flatMap(row => { const p = rowPlace(row); return p ? [{ name: p.name, primary: p.primaryGenre, roles: rolesForPlace(p), dance: venueEligibility(p, "dance").allowed, coffee: venueEligibility(p, "coffee").allowed, noBars: venueEligibility(p, "daily_life", noBars).allowed, reasons: venueEligibility(p, "daily_life", noBars).reasons }] : []; }) });
}
console.log(JSON.stringify({ controls }));
const adultTags = await searchPlaceTags("strip club");
console.log(JSON.stringify({ verifiedAdultTagIds: adultTags.filter(t => /strip|adult|gentlem/.test(`${t.id} ${t.name}`)).map(t => t.id) }));
const manifest = (await cityManifest("Lisbon")).value;
const area = manifest.areas.find(a => a.identity.name === "Anjos") ?? manifest.areas[0];
const constraints: Constraint[] = [ { id: "no-bars", kind: "exclude_type", value: "bars", strength: "hard", source: "user" }, { id: "no-museums", kind: "exclude_type", value: "museums", strength: "hard", source: "user" }, { id: "vegetarian", kind: "dietary", value: "vegetarian", strength: "hard", source: "user" }, { id: "budget", kind: "budget", value: 1, strength: "hard", source: "user" } ];
const state = ExploreState.parse({ city: "Lisbon", loves: profiles.find((p: { name: string }) => p.name === "reader").loves, days: 3, budget: 1 });
const planInput = PlanRequestV2.parse({ state, stateRevision: 21, areaIds: [area.identity.id], constraints });
let charges = 0; const started = performance.now();
const plan = PlanResponseV2.parse(await withQlooBudget(96, () => planV2(planInput), n => { charges = n; }));
assert.equal(plan.audit.hardViolations.length, 0);
const planReport = { elapsedMs: performance.now() - started, charges, days: plan.itinerary.days.map(d => ({ date: d.date, area: d.neighborhood, stops: d.stops.map(s => ({ name: s.place.name, id: s.place.id, time: s.time, price: s.place.priceLevel, role: plan.venueEvidence[s.place.id].role })), missing: d.missing })), unmet: plan.audit.unmet, recovery: plan.recoveryLog };
console.log(JSON.stringify({ plan: planReport }));
const old = plan.itinerary.days.flatMap(d => d.stops.map(s => s.place.id));
let swapReport;
if (old.length > 1) {
  const swap = PlanResponseV2.parse(await planV2({ ...planInput, existingItinerary: plan.itinerary, includeIds: old.slice(1), excludeIds: [old[0]], replacePlaceId: old[0] }));
  const updated = swap.itinerary.days.flatMap(d => d.stops.map(s => s.place.id));
  assert(!updated.includes(old[0]));
  assert(old.slice(1).every(id => updated.includes(id)), "Every unchanged stop must survive a swap");
  swapReport = { retained: old.length - 1, allRetained: true, stops: updated, hardViolations: swap.audit.hardViolations, unmet: swap.audit.unmet };
}
const addressStart = performance.now();
const address = SpotResponseV2.parse(await spotV2(SpotRequestV2.parse({ state: { ...state, budget: null }, stateRevision: 21, point: [-9.128, 38.712], areaId: area.identity.id, constraints: constraints.filter(c => c.kind !== "budget") })));
const addressReport = { elapsedMs: performance.now() - addressStart, label: address.label, precision: address.geocodeQuality, actualArea: address.area?.area.name, outsideSelectedArea: address.outsideSelectedArea, nearby: address.nearby.map(n => ({ name: n.venue.place.name, role: n.venue.role, walk: n.walkMinutes })), unmet: address.constraintsAudit.unmet };
console.log(JSON.stringify({ swap: swapReport, address: addressReport }));
writeFileSync(join(capture.directory, "b3-reference.json"), JSON.stringify({ reports, controls, planReport, swapReport, addressReport, capture: capture.counts(), plan, address }, null, 2));
capture.restore();
