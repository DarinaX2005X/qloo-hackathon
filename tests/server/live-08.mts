import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { appendFileSync } from 'node:fs';
import { profile, profiles } from './profiles-08';
import type { Neighborhood } from '../../src/shared/contracts';
import { buildField } from '../../src/server/engine/field';
import { rankNeighborhoods } from '../../src/server/engine/neighborhoods';
loadEnvFile('.env.local');
const report = 'C:/Users/user/Desktop/qloo/tasks/08-engine.out.md';
export function log(s: string) { console.log(s); if (process.argv.includes('--report')) appendFileSync(report, s + '\n'); }
log('\n## Follow-up live 08 reference run: adjusted match metric\n');
function coherent(ranked: Neighborhood[]) {
  assert(ranked[0], 'Expected ranked neighborhoods');
  for (const [i, area] of ranked.entries()) {
    assert.equal(area.liftKind, 'adjusted_match');
    assert.equal(area.lift, 2 * area.score - 1, 'Display and ordering must use the same metric');
    if (i) assert(ranked[i - 1].lift! >= area.lift!, 'Displayed values must be non-increasing');
    if (area.them !== undefined) assert.equal(area.score, Math.min(area.you, area.them));
  }
  if (ranked[0].lift! < 0) {
    assert(ranked.every(area => area.lift! < 0));
    assert(ranked[0].rankingNote?.includes('All scored neighborhoods'));
  } else assert.equal(ranked[0].rankingNote, undefined);
}
const winners = new Map<string, string>();
for (const city of ['Berlin', 'Lisbon']) {
  const counts = new Map<string, number>();
  for (const p of profiles) {
    const state = await profile(city, p.tastes);
    const started = performance.now();
    const ranked = await rankNeighborhoods(state);
    log(`${city} / ${p.name} [${state.loves.map(l => `${l.chosen?.name} (${l.chosen?.domain})`).join(', ')}]: AFTER ${ranked.slice(0, 3).map(n => `${n.name} score=${n.score.toFixed(4)} adjusted lift=${((n.lift ?? 0) * 100).toFixed(1)}% (cells=${n.cellIds.length})`).join(' | ')} (${((performance.now() - started)/1000).toFixed(2)}s)`);
    coherent(ranked);
    if (ranked[0].rankingNote) log(ranked[0].rankingNote);
    winners.set(`${city}/${p.name}`, ranked[0].name);
    counts.set(ranked[0].name, (counts.get(ranked[0].name) ?? 0) + 1);
    if (city === 'Berlin' && p.name === 'techno') {
      assert.notEqual(ranked[0].name, 'Tiergarten', 'Techno must not put Tiergarten first');
      assert(ranked.slice(0, 2).some(n => ['Friedrichshain', 'Kreuzberg', 'Neukölln'].includes(n.name)), 'Techno top two needs a credible nightlife area');
    }
  }
  log(`${city} winner counts: ${JSON.stringify(Object.fromEntries(counts))}`);
  assert(Math.max(...counts.values()) <= 2, `${city} has one winner for more than two profiles`);
}
assert.notEqual(winners.get('Berlin/reader'), winners.get('Berlin/night owl'));
assert.notEqual(winners.get('Lisbon/indie outdoors'), winners.get('Lisbon/metal sport'));
const artists = await profile('Berlin', [['Radiohead', 'artist'], ['Aphex Twin', 'artist']]);
const before = await buildField(artists);
const after = await buildField({ ...artists, loves: artists.loves.map((love, i) => ({ ...love, weight: i ? 0.05 : 1 })) });
const maxDifference = Math.max(...before.cells.map(c => Math.abs(c.you - (after.cells.find(f => f.h === c.h)?.you ?? c.you))));
assert(maxDifference > 0.01, 'Same-domain weights must change the actual field');
log(`Radiohead / Aphex Twin: weights 1:1 → 1:0.05; max cell.you change=${maxDifference.toFixed(4)}. PASS`);
const partner = await profile('Berlin', profiles[3].tastes);
const couple = { ...await profile('Berlin', profiles[0].tastes), companion: { loves: partner.loves } };
for (const discovery of [0, 1]) {
  const ranked = await rankNeighborhoods({ ...couple, discovery });
  coherent(ranked);
  log(`Berlin / couple / crowd=${discovery}: ${ranked.slice(0, 3).map(n => `${n.name} score=${n.score.toFixed(4)} adjusted lift=${(100 * n.lift!).toFixed(1)}%`).join(' | ')}${ranked[0].rankingNote ? ` ${ranked[0].rankingNote}` : ''}`);
}
log('PASS: all ranking reference expectations.');
