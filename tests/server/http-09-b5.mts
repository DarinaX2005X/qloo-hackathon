import assert from "node:assert/strict";
import { ExploreState } from "../../src/shared/contracts";

const base = process.env.BASE_URL ?? "http://localhost:3001";
const state = ExploreState.parse({ city: "Lisbon", loves: [] });
for (const [route, body, status] of [
  ["field", { ...state, responseVersion: 2, state, stateRevision: -1 }, 400],
  ["field", { ...state, responseVersion: 3 }, 400],
  ["plan", { responseVersion: 2, state, stateRevision: 0, areaIds: [] }, 400],
  ["home", { responseVersion: 2, state, stateRevision: 0, source: { city: "Lisbon", neighborhood: "Alfama" }, lambda: .35 }, 400],
  ["cities", { responseVersion: 2, state, stateRevision: 0, cities: ["Atlantiszzzz", "Qxzvnotacity"], source: { city: "Lisbon", neighborhood: "Alfama" } }, 400],
] as const) {
  const response = await fetch(`${base}/api/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data));
  console.log(JSON.stringify({ route, status: response.status, error: data.error?.code }));
}
const search = await fetch(`${base}/api/search?q=zxqv-no-such-band-92841&responseVersion=2`).then(r => r.json());
assert.equal(search.resolution, "no_match"); assert.equal(search.results.length, 0);
const localities = await fetch(`${base}/api/localities?q=Montr%C3%A9al`).then(r => r.json());
assert.equal(localities.results[0].country, "Canada");
console.log(JSON.stringify({ gibberish: search.resolution, firstLocality: localities.results[0].query, country: localities.results[0].country }));
