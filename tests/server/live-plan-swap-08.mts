import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ExploreState, Itinerary } from '../../src/shared/contracts';

const base = process.env.PLAN_TEST_URL ?? 'http://localhost:3001';
const fixture = JSON.parse(readFileSync('tests/server/__fixtures__/03-lisbon.json', 'utf8'));
const state = ExploreState.parse({ ...fixture.state, loves: fixture.state.loves.slice(0, 2), pace: 'packed', days: 2,
  budget: 2, refinements: [{ id: 'urn:tag:decor:qloo:cozy', name: 'Cozy', kind: 'decor' }] });
async function post(path: string, body: unknown) {
  const started = performance.now();
  const response = await fetch(`${base}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  console.log(`${path}: ${((performance.now() - started) / 1000).toFixed(2)}s`);
  return data;
}
const { neighborhoods } = await post('neighborhoods', state);
const request = { ...state, neighborhoodIds: neighborhoods.slice(0, 2).map((n: { id: string }) => n.id) };
const before = Itinerary.parse(await post('plan', request));
const first = before.days[0].stops[0]?.place;
assert(first, 'The initial plan must have a first stop');
for (const [i, day] of before.days.entries()) console.log(`Before day ${i + 1} (${day.neighborhood}): ${day.stops.map(s => s.place.name).join('; ')}`);
console.log(`Exclude: ${first.name} [${first.id}]`);
const after = Itinerary.parse(await post('plan', { ...request, exclude: [first.id] }));
for (const [i, day] of after.days.entries()) console.log(`After day ${i + 1} (${day.neighborhood}): ${day.stops.map(s => s.place.name).join('; ')}`);
assert.equal(after.days.length, 2);
assert(after.days[0].stops[0] && after.days[0].stops[0].place.id !== first.id);
assert(after.days.every(day => day.stops.every(s => s.place.id !== first.id)), 'Excluded ID must be absent from every day');
for (const [i, day] of before.days.entries()) {
  const retained = day.stops.filter(s => s.place.id !== first.id);
  console.log(`Day ${i + 1}: ${retained.filter(s => after.days[i].stops.some(t => t.place.id === s.place.id)).length}/${retained.length} other stops retained`);
}
console.log('PASS: swapped place is absent from the whole itinerary.');
