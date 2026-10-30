import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { appendFileSync } from 'node:fs';
import { profile, profiles } from './profiles-08';
import { runAgent } from '../../src/server/agent/runner';
import { isMuseumPlace } from '../../src/server/engine/plan';
import type { AgentEvent } from '../../src/shared/contracts';

loadEnvFile('.env.local');
const log = (line: string) => {
  console.log(line);
  if (process.argv.includes('--report')) appendFileSync('C:/Users/user/Desktop/qloo/tasks/08-engine.out.md', line + '\n');
};
const message = 'plan my first two days, I hate museums';
log('\n## Follow-up: live agent museum exclusion checks\n');
log(`Same request and indie/outdoors profile in both cities: "${message}". Every returned stop is checked, including recovery stops.`);
for (const city of ['Lisbon', 'Berlin']) {
  const state = await profile(city, profiles[5].tastes);
  const events: AgentEvent[] = [];
  const started = performance.now();
  await runAgent({ state, message, history: [] }, e => events.push(e));
  const itinerary = events.flatMap(e => e.type === 'card' && e.card.kind === 'plan' ? [e.card.itinerary] : []).at(-1);
  log(`\n${city}: ${((performance.now() - started) / 1000).toFixed(2)}s; tools: ${events.flatMap(e => e.type === 'trace' ? [e.tool] : []).join(' → ')}`);
  if (!itinerary) log(`No plan returned. ${JSON.stringify(events.filter(e => e.type === 'error' || e.type === 'delta'))}`);
  assert(itinerary, `${city}: agent must return a plan card`);
  assert.equal(itinerary.days.length, 2, `${city}: requested two days`);
  assert(itinerary.days.flatMap(d => d.stops).length > 0, `${city}: not a vacuous empty-plan pass`);
  for (const [i, day] of itinerary.days.entries()) {
    log(`Day ${i + 1}, ${day.neighborhood}: ${day.stops.map(s => `${s.place.name} [${s.place.category}]`).join('; ') || '(no stops)'}. Missing: ${day.missing.join(', ') || 'none'}. Note: ${day.note ?? 'none'}`);
    assert(day.stops.length || day.note, `${city}: empty day needs an explanation`);
    for (const stop of day.stops) {
      assert(!isMuseumPlace(stop.place), `${city}: forbidden museum/gallery ${stop.place.name}`);
      if (stop.place.category === 'culture') log(`Retained culture: ${stop.place.name}; classifiers: ${(stop.place.classifications ?? []).filter(c => /genre|book|cinema|music|theat|concert/i.test(c)).join(', ')}`);
    }
    assert(!day.note?.includes('no eligible open stops'), 'No blanket open/closed claim');
    if (/\bclosed\b/.test(day.note ?? '')) assert(day.issues?.some(issue => issue.reason === 'closed') || day.missing.some(s => s.includes('closed at the available times')), 'Closure wording needs closure evidence');
  }
  log(`PASS ${city}: no museum/gallery stops. Agent: ${events.flatMap(e => e.type === 'delta' ? [e.text] : []).join('')}`);
}
